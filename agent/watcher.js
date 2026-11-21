require("dotenv").config();
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { sendAlert } = require("./notifier");
const { buildReleaseBundle } = require("./releaseBuilder");
const { processPacketQueue } = require("./queueRelayer");
const { startBridgeServer } = require("./bridgeServer");

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

async function withRpcRetry(fn, retries = 3, baseDelayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[Watcher] RPC attempt ${attempt}/${retries} failed (${err.message}). Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function checkContractOnce(contract) {
  // 0. Process any queued offline EIP-712 check-in packets first
  if (contract.runner && contract.runner.provider) {
    await processPacketQueue({
      contract,
      provider: contract.runner.provider,
    });
  }
  const stageNum = Number(await withRpcRetry(() => contract.getStage()));
  const stageName = STAGE_NAMES[stageNum] || "UNKNOWN";
  const lastCheckIn = Number(await withRpcRetry(() => contract.lastCheckIn()));
  const duressTriggered = await withRpcRetry(() => contract.duressTriggered());
  const isReleasedLatched = await withRpcRetry(() => contract.released());
  const evidenceHash = await withRpcRetry(() => contract.evidenceHash());

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
    let releaseTxHash = null;
    if (!isReleasedLatched && !stateTracker.releaseFinalized) {
      console.log("[Action] Day 5 threshold reached! Calling finalizeRelease() on-chain...");
      const receipt = await withRpcRetry(async () => {
        const tx = await contract.finalizeRelease();
        return await tx.wait();
      });
      releaseTxHash = receipt.hash;
      stateTracker.releaseFinalized = true;
      console.log("[Action] Release permanently latched! Tx:", releaseTxHash);
    }

    if (stateTracker.lastNotifiedStage !== 2) {
      stateTracker.lastNotifiedStage = 2;

      let releaseDetails = `Registered Evidence Hash: ${evidenceHash}`;
      try {
        const bundle = buildReleaseBundle({
          contractAddress: deployment.address,
          chainId: deployment.chainId,
          onChainEvidenceHash: evidenceHash,
          releaseTxHash,
        });
        releaseDetails =
          `Evidence Hash: ${bundle.evidence.evidenceHash}\n` +
          `Storage URI: ${bundle.evidence.storageUri}\n` +
          `Algorithm: ${bundle.evidence.algorithm}\n` +
          `Decryption Key (Base64): ${bundle.evidence.keyBase64}\n` +
          `IV (Base64): ${bundle.evidence.ivBase64}`;
      } catch (escrowErr) {
        releaseDetails += `\n(Note: Local escrow bundle skipped: ${escrowErr.message})`;
      }

      await sendAlert({
        level: "EMERGENCY - RELEASED",
        title: "Dead Man's Switch RELEASED",
        message:
          `Contract ${deployment.address} has permanently latched into RELEASED state.\n` +
          releaseDetails,
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

  const bridgeServer = startBridgeServer({ contract, provider });

  // Run immediately once, then on interval
  await checkContractOnce(contract);
  const intervalId = setInterval(async () => {
    try {
      await checkContractOnce(contract);
    } catch (err) {
      console.error("[Poll Error]", err.message);
    }
  }, pollMs);

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Watcher] Received ${signal}. Shutting down gracefully...`);
    clearInterval(intervalId);
    if (bridgeServer) {
      bridgeServer.close(() => {
        console.log("[Bridge] HTTP Bridge closed cleanly.");
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 2000).unref();
    } else {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
  startWatcher().catch((err) => {
    console.error("Fatal watcher error:", err);
    process.exit(1);
  });
}

module.exports = { checkContractOnce, stateTracker, withRpcRetry };