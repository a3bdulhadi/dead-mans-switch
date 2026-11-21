const assert = require("assert");
const { checkContractOnce, stateTracker } = require("./watcher");

async function runResilienceTests() {
  console.log("=== Day 24: RPC Retry & Daemon Resilience Tests ===");

  stateTracker.lastNotifiedStage = null;
  stateTracker.duressNotified = false;
  stateTracker.releaseFinalized = false;

  // 1. Simulate 2 transient RPC failures followed by recovery on attempt 3
  let attempts = 0;
 const flakyContract = {
    getStage: async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("ECONNRESET: temporary RPC drop");
      }
      return 0n;
    },
    lastCheckIn: async () => 1700000000n,
    duressTriggered: async () => false,
    released: async () => false,
    evidenceHash: async () => "0x" + "0".repeat(64),
  };
  await checkContractOnce(flakyContract);
  assert.strictEqual(attempts, 3);
  assert.strictEqual(stateTracker.lastNotifiedStage, 0);
  console.log("PASS 1: Recovered automatically after 2 transient RPC errors.");

  // 2. Verify permanent RPC outage surfaces error after max retries
  const deadContract = {
    getStage: async () => {
      throw new Error("ENOTFOUND: RPC node offline");
    },
  };

  let threw = false;
  try {
    await checkContractOnce(deadContract);
  } catch (err) {
    threw = err.message.includes("ENOTFOUND");
  }
  assert.strictEqual(threw, true);
  console.log("PASS 2: Permanent RPC failure propagated cleanly after retries.");
}

runResilienceTests().catch((err) => {
  console.error("Resilience test failed:", err);
  process.exit(1);
});