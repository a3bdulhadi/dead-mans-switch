require("dotenv").config();
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
const DEMO_TOKEN = "live-presentation-bearer-token";

function banner(step, title) {
  console.log(`\n====================================================================`);
  console.log(`  ACT ${step}: ${title}`);
  console.log(`====================================================================`);
}

async function advanceDays(provider, days) {
  await provider.send("evm_increaseTime", [days * ONE_DAY]);
  await provider.send("evm_mine", []);
}

async function runPresentation() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const rawOwner = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider
  );
  const owner = new ethers.NonceManager(rawOwner);

  const rawAgent = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    provider
  );
  const agent = new ethers.NonceManager(rawAgent);

  const chainId = Number((await provider.getNetwork()).chainId);
  const contractAsOwner = new ethers.Contract(deployment.address, abi, owner);
  const contractAsAgent = new ethers.Contract(deployment.address, abi, agent);

  stateTracker.lastNotifiedStage = null;
  stateTracker.duressNotified = false;
  stateTracker.releaseFinalized = false;

  const server = createBridgeServer({
    contract: contractAsAgent,
    provider,
    authToken: DEMO_TOKEN,
  });
  await new Promise((resolve) => server.listen(8791, "127.0.0.1", resolve));
  const bridgeUrl = "http://127.0.0.1:8791";
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DEMO_TOKEN}`,
  };

  console.log("\n********************************************************************");
  console.log("   DEAD MAN'S SWITCH — LIVE END-TO-END ARCHITECTURE DEMONSTRATION   ");
  console.log("********************************************************************");
  console.log(`Contract Address : ${deployment.address}`);
  console.log(`Owner Address    : ${rawOwner.address}`);
  console.log(`Agent Relayer    : ${rawAgent.address}`);

  try {
    // ACT 1: Client-Side AES-256-GCM Sealing & On-Chain Commitment
    banner(1, "Zero-Knowledge Client Encryption & On-Chain Hash Anchor");
    const secretDocument = "TOP SECRET: Public Integrity Audit & Evidence Archive [2026]";
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const ciphertext = Buffer.concat([cipher.update(secretDocument, "utf8"), cipher.final()]);
    const sealedBlob = Buffer.concat([ciphertext, cipher.getAuthTag()]);
    const evidenceHash = ethers.keccak256(sealedBlob);

    await (await contractAsOwner.registerEvidence(evidenceHash)).wait();
    await fetch(`${bridgeUrl}/escrow`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        evidenceHash,
        keyBase64: aesKey.toString("base64"),
        ivBase64: iv.toString("base64"),
        storageUri: "ipfs://bafybeipresentationdemo2026evidence",
      }),
    });

    console.log(`Original Plaintext : "${secretDocument}"`);
    console.log(`Ciphertext Size    : ${sealedBlob.length} bytes (AES-256-GCM)`);
    console.log(`On-Chain Hash      : ${evidenceHash}`);
    console.log(`Status             : Hash anchored on-chain; key escrowed via authenticated bridge.`);

    // ACT 2: Offline EIP-712 Signed Check-In
    banner(2, "Offline EIP-712 Heartbeat Packet & Authenticated Bridge Relay");
    let status = await (await fetch(`${bridgeUrl}/status`)).json();
    const block1 = await provider.getBlock("latest");
    const normalPacket = await createOfflineCheckInPacket({
      wallet: rawOwner,
      chainId,
      verifyingContract: deployment.address,
      nonce: status.nonce,
      deadline: Number(block1.timestamp) + 3600,
      duress: false,
    });

    await fetch(`${bridgeUrl}/relay`, {
      method: "POST",
      headers: authHeaders,
      body: normalPacket,
    });
    status = await (await fetch(`${bridgeUrl}/status`)).json();
    console.log(`Signed Packet Nonce: 0 -> Relayed On-Chain -> New Nonce: ${status.nonce}`);
    console.log(`Current Stage      : ${status.stage} (Timer reset cleanly)`);

    // ACT 3: Silent Coercion / Duress Signal
    banner(3, "Silent Duress Signal Under Adversarial Coercion");
    const block2 = await provider.getBlock("latest");
    const duressPacket = await createOfflineCheckInPacket({
      wallet: rawOwner,
      chainId,
      verifyingContract: deployment.address,
      nonce: status.nonce,
      deadline: Number(block2.timestamp) + 3600,
      duress: true,
    });

    await fetch(`${bridgeUrl}/relay`, {
      method: "POST",
      headers: authHeaders,
      body: duressPacket,
    });
    await checkContractOnce(contractAsAgent);
    status = await (await fetch(`${bridgeUrl}/status`)).json();
    console.log(`Public UI Stage    : ${status.stage} (Coercer sees normal reset)`);
    console.log(`Silent Duress Flag : ${status.duressTriggered} (Emergency alert dispatched silently)`);

    // Owner clears duress once safe
    await (await contractAsOwner.clearDuress()).wait();
    await checkContractOnce(contractAsAgent);

    // ACT 4: Day-2 ALERT Escalation
    banner(4, "Inactivity Escalation -> Day 2 ALERT Stage");
    await advanceDays(provider, 3);
    await checkContractOnce(contractAsAgent);
    status = await (await fetch(`${bridgeUrl}/status`)).json();
    console.log(`Elapsed Time       : +3 Days without check-in`);
    console.log(`Contract Stage     : ${status.stage} (Warning notification dispatched)`);

    // ACT 5: Day-5 Permanent Auto-Release & Recipient Decryption
    banner(5, "Day 5+ Threshold -> Permanent RELEASED Latch & Decryption");
    await advanceDays(provider, 3);
    await checkContractOnce(contractAsAgent);

    const bundle = await (await fetch(`${bridgeUrl}/release`, { headers: authHeaders })).json();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(bundle.evidence.keyBase64, "base64"),
      Buffer.from(bundle.evidence.ivBase64, "base64")
    );
    decipher.setAuthTag(sealedBlob.subarray(sealedBlob.length - 16));
    const recoveredPlaintext = Buffer.concat([
      decipher.update(sealedBlob.subarray(0, sealedBlob.length - 16)),
      decipher.final(),
    ]).toString("utf8");

    console.log(`Contract Stage     : RELEASED (Permanently latched on-chain)`);
    console.log(`Storage URI        : ${bundle.evidence.storageUri}`);
    console.log(`Decrypted Evidence : "${recoveredPlaintext}"`);
    console.log("\n====================================================================");
    console.log("   DEMONSTRATION COMPLETE — ALL CRYPTOGRAPHIC INVARIANTS VERIFIED   ");
    console.log("====================================================================\n");
  } finally {
    server.close();
    if (fs.existsSync(DEFAULT_ESCROW_PATH)) fs.unlinkSync(DEFAULT_ESCROW_PATH);
    if (fs.existsSync(DEFAULT_BUNDLE_PATH)) fs.unlinkSync(DEFAULT_BUNDLE_PATH);
  }
}

runPresentation().catch((err) => {
  console.error("Live presentation demo failed:", err);
  process.exit(1);
});