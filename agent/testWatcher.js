require("dotenv").config();
const assert = require("assert");
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { createOfflineCheckInPacket, relayOfflineCheckInPacket } = require("./packetHelper");
const { checkContractOnce, stateTracker } = require("./watcher");

const ONE_DAY = 24 * 60 * 60;

async function advanceBlockchainTime(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function runWatcherSimulation() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Hardhat Account #0 (owner) and Account #1 (agent/relayer)
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
  const contractAsOwner = new ethers.Contract(deployment.address, abi, ownerWallet);
  const contractAsAgent = new ethers.Contract(deployment.address, abi, agentWallet);

  // Reset in-memory tracker cleanly before simulation
  stateTracker.lastNotifiedStage = null;
  stateTracker.duressNotified = false;
  stateTracker.releaseFinalized = false;

  console.log("=== Day 16: Autonomous Watcher End-to-End Simulation ===");
  console.log("Contract:", deployment.address);

  // 0. Register dummy evidence hash if not already registered
  const currentHash = await contractAsAgent.evidenceHash();
  if (currentHash === ethers.ZeroHash) {
    const dummyHash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-evidence-bundle-v1"));
    const regTx = await contractAsOwner.registerEvidence(dummyHash);
    await regTx.wait();
    console.log("Registered evidenceHash:", dummyHash);
  }

  // 1. Poll in SAFE stage
  await checkContractOnce(contractAsAgent);
  assert.strictEqual(stateTracker.lastNotifiedStage, 0);
  assert.strictEqual(stateTracker.duressNotified, false);
  console.log("PASS 1: SAFE stage polled with zero false alarms.");

  // 2. Simulate Silent Duress Check-In (duress = true)
  const nonce = Number(await contractAsAgent.nonce());
  const blockBeforeDuress = await provider.getBlock("latest");
  const duressPacket = await createOfflineCheckInPacket({
    wallet: ownerWallet,
    chainId,
    verifyingContract: deployment.address,
    nonce,
    deadline: Number(blockBeforeDuress.timestamp) + 3600,
    duress: true,
  });

  await relayOfflineCheckInPacket({
    packetJson: duressPacket,
    contract: contractAsAgent,
    expectedOwner: ownerWallet.address,
    currentTimestamp: Number(blockBeforeDuress.timestamp),
  });

  await checkContractOnce(contractAsAgent);
  assert.strictEqual(stateTracker.duressNotified, true);
  assert.strictEqual(Number(await contractAsAgent.getStage()), 0); // Still SAFE to coercer
  console.log("PASS 2: Silent duress detected and alert dispatched while UI remains SAFE.");

  // Clear duress as owner so we proceed cleanly into time-warp stage tests
  const clearTx = await contractAsOwner.clearDuress();
  await clearTx.wait();
  await checkContractOnce(contractAsAgent);
  assert.strictEqual(stateTracker.duressNotified, false);

  // 3. Fast-forward 3 days -> Stage 1 (ALERT)
  console.log("\n[Time Warp] Advancing local blockchain by +3 days...");
  await advanceBlockchainTime(provider, 3 * ONE_DAY);

  await checkContractOnce(contractAsAgent);
  assert.strictEqual(Number(await contractAsAgent.getStage()), 1);
  assert.strictEqual(stateTracker.lastNotifiedStage, 1);
  console.log("PASS 3: Day-2+ ALERT stage detected and warning dispatched.");

  // 4. Fast-forward +3 more days (total 6 days) -> Stage 2 (RELEASED) + auto-latch
  console.log("\n[Time Warp] Advancing local blockchain by +3 more days (6 days total)...");
  await advanceBlockchainTime(provider, 3 * ONE_DAY);

  await checkContractOnce(contractAsAgent);
  assert.strictEqual(Number(await contractAsAgent.getStage()), 2);
  assert.strictEqual(await contractAsAgent.released(), true);
  assert.strictEqual(stateTracker.releaseFinalized, true);
  assert.strictEqual(stateTracker.lastNotifiedStage, 2);
  console.log("PASS 4: Day-5+ RELEASED stage triggered automatic finalizeRelease() latch and emergency alert!");
}

runWatcherSimulation().catch((err) => {
  console.error("Watcher simulation failed:", err);
  process.exit(1);
});