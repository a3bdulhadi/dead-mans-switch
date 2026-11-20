require("dotenv").config();
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { sendAlert } = require("./notifier");

const STAGE_NAMES = {
  0: "SAFE",
  1: "ALERT",
  2: "RELEASED",
};

// Track sent notifications in memory so the daemon does not spam on every poll tick
const stateTracker = {
  lastNotifiedStage: null,
  duressNotified: false,
  releaseFinalized: false,
};

async function checkContractOnce(contract) {
  const stageNum = Number(await contract.getStage());
  const stageName = STAGE_NAMES[stageNum] || "UNKNOWN";
  const lastCheckIn = Number(await contract.lastCheckIn());
  const duressTriggered = await contract.duressTriggered();
  const isReleasedLatched = await contract.released();
  const evidenceHash = await contract.evidenceHash();

  console.log(
    `[Poll] Stage=${stageName} | lastCheckIn=${lastCheckIn} | duress=${duressTriggered} | latched=${isReleasedLatched}`
  );

  // 1. Detect Silent Duress Signal
  if (duressTriggered && !stateTracker.duressNotified) {
    stateTracker.duressNotified = true;
    await sendAlert({
      level: "CRITICAL - DURESS",
      title: "Silent Duress Check-In Detected",
      message:
        `Contract ${deployment.address} recorded a check-in with duress=true.\n` +
        `The switch appears SAFE to any coercer, but emergency escalation is active.`,
    });
  } else if (!duressTriggered && stateTracker.duressNotified) {
    // Owner safely cleared duress flag
    stateTracker.duressNotified = false;
  }

  // 2. Detect Stage Transitions (SAFE -> ALERT -> RELEASED)
  if (stageNum === 1 && stateTracker.lastNotifiedStage !== 1) {
    stateTracker.lastNotifiedStage = 1;
    await sendAlert({
      level: "WARNING - DAY 2 ALERT",
      title: "Dead Man's Switch Entered ALERT Stage",
      message:
        `No check-in received for >= 2 days on contract ${deployment.address}.\n` +
        `Please submit a signed EIP-712 check-in before Day 5 to prevent public release.`,
    });
  }

  if (stageNum === 0) {
    stateTracker.lastNotifiedStage = 0;
  }

  // 3. Automatic Release Latch at Day 5+ (Stage === RELEASED)
  if (stageNum === 2) {
    if (!isReleasedLatched && !stateTracker.releaseFinalized) {
      console.log("[Action] Day 5 threshold reached! Calling finalizeRelease() on-chain...");
      const tx = await contract.finalizeRelease();
      const receipt = await tx.wait();
      stateTracker.releaseFinalized = true;
      console.log("[Action] Release permanently latched! Tx:", receipt.hash);
    }

    if (stateTracker.lastNotifiedStage !== 2) {
      stateTracker.lastNotifiedStage = 2;
      await sendAlert({
        level: "EMERGENCY - RELEASED",
        title: "Dead Man's Switch RELEASED",
        message:
          `Contract ${deployment.address} has permanently latched into RELEASED state.\n` +
          `Registered Evidence Hash: ${evidenceHash}\n` +
          `Executing public key & evidence release payload.`,
      });
    }
  }
}

async function startWatcher() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const privateKey =
    process.env.RELAYER_PRIVATE_KEY ||
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 5000);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const agentWallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(deployment.address, abi, agentWallet);

  console.log("Starting Dead Man's Switch Autonomous Agent...");
  console.log("RPC URL:", rpcUrl);
  console.log("Contract:", deployment.address);
  console.log("Agent Relayer Address:", agentWallet.address);

  // Run immediately once, then on interval
  await checkContractOnce(contract);
  setInterval(async () => {
    try {
      await checkContractOnce(contract);
    } catch (err) {
      console.error("[Poll Error]", err.message);
    }
  }, pollMs);
}

if (require.main === module) {
  startWatcher().catch((err) => {
    console.error("Fatal watcher error:", err);
    process.exit(1);
  });
}

module.exports = { checkContractOnce, stateTracker };