require("dotenv").config();
const assert = require("assert");
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { createOfflineCheckInPacket } = require("./packetHelper");
const { createBridgeServer } = require("./bridgeServer");

async function runBridgeTest() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const ownerWallet = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider
  );
  const agentWallet = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    provider
  );

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const contractAsAgent = new ethers.Contract(deployment.address, abi, agentWallet);

  const server = createBridgeServer({ contract: contractAsAgent, provider });
  await new Promise((resolve) => server.listen(8788, "127.0.0.1", resolve));

  const baseUrl = "http://127.0.0.1:8788";

  try {
    // 1. GET /status
    const statusRes = await fetch(`${baseUrl}/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.strictEqual(statusJson.stage, "SAFE");
    console.log("PASS 1: GET /status returned stage=SAFE and nonce=" + statusJson.nonce);

    // 2. GET /release while still SAFE must return 403
    const earlyReleaseRes = await fetch(`${baseUrl}/release`);
    assert.strictEqual(earlyReleaseRes.status, 403);
    console.log("PASS 2: Premature GET /release blocked with 403 Forbidden.");

    // 3. POST /relay with signed EIP-712 packet
    const block = await provider.getBlock("latest");
    const packetJson = await createOfflineCheckInPacket({
      wallet: ownerWallet,
      chainId,
      verifyingContract: deployment.address,
      nonce: statusJson.nonce,
      deadline: Number(block.timestamp) + 3600,
      duress: false,
    });

    const relayRes = await fetch(`${baseUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: packetJson,
    });
    assert.strictEqual(relayRes.status, 200);
    const relayJson = await relayRes.json();
    assert.strictEqual(relayJson.ok, true);
    assert.strictEqual(relayJson.newNonce, statusJson.nonce + 1);
    console.log("PASS 3: POST /relay submitted signed packet on-chain and incremented nonce to " + relayJson.newNonce);
  } finally {
    server.close();
  }
}

runBridgeTest().catch((err) => {
  console.error("Bridge test failed:", err);
  process.exit(1);
});