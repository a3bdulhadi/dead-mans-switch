require("dotenv").config();
const assert = require("assert");
const fs = require("fs");
const crypto = require("crypto");
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { createOfflineCheckInPacket } = require("./packetHelper");
const { createBridgeServer } = require("./bridgeServer");
const { checkContractOnce, stateTracker } = require("./watcher");
const { DEFAULT_ESCROW_PATH, DEFAULT_BUNDLE_PATH } = require("./releaseBuilder");

const ONE_DAY = 24 * 60 * 60;

async function advanceBlockchainTime(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function runE2EDemo() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const rawOwnerWallet = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider
  );
  const ownerWallet = new ethers.NonceManager(rawOwnerWallet);

  const rawAgentWallet = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    provider
  );
  const agentWallet = new ethers.NonceManager(rawAgentWallet);

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const contractAsOwner = new ethers.Contract(deployment.address, abi, ownerWallet);
  const contractAsAgent = new ethers.Contract(deployment.address, abi, agentWallet);

  // Reset watcher memory state
  stateTracker.lastNotifiedStage = null;
  stateTracker.duressNotified = false;
  stateTracker.releaseFinalized = false;

  const server = createBridgeServer({ contract: contractAsAgent, provider });
  await new Promise((resolve) => server.listen(8789, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:8789";

  console.log("=== Day 22: Full Browser-to-Blockchain End-to-End Integration ===");

  try {
    // 1. Encrypt sample evidence payload with AES-256-GCM (matching PWA WebCrypto flow)
    const plaintext = Buffer.from("CONFIDENTIAL JOURNALIST DOSSIER - VERIFIED RELEASE", "utf8");
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const sealedBlob = Buffer.concat([ciphertext, authTag]);

    const evidenceHash = ethers.keccak256(sealedBlob);
    const regTx = await contractAsOwner.registerEvidence(evidenceHash);
    await regTx.wait();

    // Seed local escrow via PWA Bridge POST /escrow
    const escrowRes = await fetch(`${baseUrl}/escrow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evidenceHash,
        keyBase64: aesKey.toString("base64"),
        ivBase64: iv.toString("base64"),
        storageUri: "ipfs://bafybeie2edemobundle2026deadmansswitch",
      }),
    });
    assert.strictEqual(escrowRes.status, 200);
    console.log("PASS 1: Evidence hash registered on-chain & key escrowed via POST /escrow.");

    // 2. Normal Offline Check-In via PWA Bridge POST /relay
    let status = await (await fetch(`${baseUrl}/status`)).json();
    const block1 = await provider.getBlock("latest");
    const normalPacket = await createOfflineCheckInPacket({
      wallet: rawOwnerWallet,
      chainId,
      verifyingContract: deployment.address,
      nonce: status.nonce,
      deadline: Number(block1.timestamp) + 3600,
      duress: false,
    });

    const relay1 = await fetch(`${baseUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: normalPacket,
    });
    assert.strictEqual(relay1.status, 200);
    console.log("PASS 2: Normal offline EIP-712 check-in relayed via POST /relay.");

    // 3. Silent Duress Check-In via PWA Bridge POST /relay
    status = await (await fetch(`${baseUrl}/status`)).json();
    const block2 = await provider.getBlock("latest");
    const duressPacket = await createOfflineCheckInPacket({
      wallet: rawOwnerWallet,
      chainId,
      verifyingContract: deployment.address,
      nonce: status.nonce,
      deadline: Number(block2.timestamp) + 3600,
      duress: true,
    });

    const relay2 = await fetch(`${baseUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: duressPacket,
    });
    assert.strictEqual(relay2.status, 200);

    await checkContractOnce(contractAsAgent);
    status = await (await fetch(`${baseUrl}/status`)).json();
    assert.strictEqual(status.stage, "SAFE"); // UI still appears SAFE to coercer
    assert.strictEqual(status.duressTriggered, true);
    console.log("PASS 3: Silent duress relayed; UI shows SAFE while emergency alert fired.");

    // Owner clears duress once safe
    const clearTx = await contractAsOwner.clearDuress();
    await clearTx.wait();
    await checkContractOnce(contractAsAgent);

    // 4. Time-warp +6 days -> Auto-Release & Recipient Decryption via GET /release
    await advanceBlockchainTime(provider, 6 * ONE_DAY);
    await checkContractOnce(contractAsAgent);

    const releaseRes = await fetch(`${baseUrl}/release`);
    assert.strictEqual(releaseRes.status, 200);
    const releaseBundle = await releaseRes.json();
    assert.strictEqual(releaseBundle.status, "RELEASED");

    // Verify recipient can decrypt the sealed AES-256-GCM blob using the released bundle
    const recoveredKey = Buffer.from(releaseBundle.evidence.keyBase64, "base64");
    const recoveredIv = Buffer.from(releaseBundle.evidence.ivBase64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", recoveredKey, recoveredIv);
    decipher.setAuthTag(sealedBlob.subarray(sealedBlob.length - 16));
    const decrypted = Buffer.concat([
      decipher.update(sealedBlob.subarray(0, sealedBlob.length - 16)),
      decipher.final(),
    ]).toString("utf8");

    assert.strictEqual(decrypted, plaintext.toString("utf8"));
    console.log("PASS 4: Day-5+ auto-release delivered key via GET /release and decrypted dossier cleanly!");
  } finally {
    server.close();
    if (fs.existsSync(DEFAULT_ESCROW_PATH)) fs.unlinkSync(DEFAULT_ESCROW_PATH);
    if (fs.existsSync(DEFAULT_BUNDLE_PATH)) fs.unlinkSync(DEFAULT_BUNDLE_PATH);
  }
}

runE2EDemo().catch((err) => {
  console.error("E2E Demo failed:", err);
  process.exit(1);
});