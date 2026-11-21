require("dotenv").config();
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { createOfflineCheckInPacket } = require("./packetHelper");
const { processPacketQueue, DEFAULT_QUEUE_DIR, DEFAULT_PROCESSED_DIR } = require("./queueRelayer");

async function runQueueTest() {
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

  const initialNonce = Number(await contractAsAgent.nonce());
  const block = await provider.getBlock("latest");
  const currentTimestamp = Number(block.timestamp);

  // 1. Owner generates an offline packet and drops it into agent/queue/
  const packetJson = await createOfflineCheckInPacket({
    wallet: ownerWallet,
    chainId,
    verifyingContract: deployment.address,
    nonce: initialNonce,
    deadline: currentTimestamp + 3600,
    duress: false,
  });

  const queuedFile = path.join(DEFAULT_QUEUE_DIR, "checkin_test_packet.json");
  fs.writeFileSync(queuedFile, packetJson, "utf8");

  // 2. Run queue processor
  const summary = await processPacketQueue({
    contract: contractAsAgent,
    provider,
  });

  assert.strictEqual(summary.processed, 1);
  assert.strictEqual(summary.failed, 0);
  assert.strictEqual(fs.existsSync(queuedFile), false);
  assert.strictEqual(Number(await contractAsAgent.nonce()), initialNonce + 1);
  console.log("PASS 1: Queued offline packet relayed on-chain and moved to processed/.");

  // Clean up test archive files inside processed/
  for (const f of fs.readdirSync(DEFAULT_PROCESSED_DIR)) {
    if (f.endsWith("checkin_test_packet.json")) {
      fs.unlinkSync(path.join(DEFAULT_PROCESSED_DIR, f));
    }
  }
}

runQueueTest().catch((err) => {
  console.error("Queue relayer test failed:", err);
  process.exit(1);
});