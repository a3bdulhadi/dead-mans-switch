const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const seenPacketHashes = new Set();
const { relayOfflineCheckInPacket } = require("./packetHelper");

const DEFAULT_QUEUE_DIR = path.join(__dirname, "queue");
const DEFAULT_PROCESSED_DIR = path.join(DEFAULT_QUEUE_DIR, "processed");

/**
 * Scans agent/queue/ for pending .json offline check-in packets, verifies each
 * against the on-chain owner and current block timestamp, submits valid packets
 * via checkInWithSignature(), and moves processed/invalid files out of the active queue.
 */
async function processPacketQueue({
  contract,
  provider,
  queueDir = DEFAULT_QUEUE_DIR,
  processedDir = DEFAULT_PROCESSED_DIR,
}) {
  if (!fs.existsSync(queueDir)) {
    return { processed: 0, failed: 0 };
  }

  if (!fs.existsSync(processedDir)) {
    fs.mkdirSync(processedDir, { recursive: true });
  }

  const files = fs
    .readdirSync(queueDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    return { processed: 0, failed: 0 };
  }

  const expectedOwner = await contract.owner();
  const block = await provider.getBlock("latest");
  const currentTimestamp = Number(block.timestamp);

  let processed = 0;
  let failed = 0;

  for (const file of files) {
    const fullPath = path.join(queueDir, file);
    try {
      const packetJson = fs.readFileSync(fullPath, "utf8");
      const packetHash = crypto.createHash("sha256").update(packetJson).digest("hex");

      if (seenPacketHashes.has(packetHash)) {
        const dupPath = path.join(processedDir, `DUPLICATE_${Date.now()}_${file}`);
        fs.renameSync(fullPath, dupPath);
        failed++;
        console.warn(`[Queue] Duplicate packet skipped: ${file}`);
        continue;
      }

      const result = await relayOfflineCheckInPacket({
        packetJson,
        contract,
        expectedOwner,
        currentTimestamp,
      });

      seenPacketHashes.add(packetHash);
      const destPath = path.join(processedDir, `${Date.now()}_${file}`);
      fs.renameSync(fullPath, destPath);
      processed++;
      console.log(`[Queue] Relayed offline packet ${file} -> Tx: ${result.receipt.hash}`);
    } catch (err) {
      const failedPath = path.join(processedDir, `FAILED_${Date.now()}_${file}`);
      fs.renameSync(fullPath, failedPath);
      failed++;
      console.error(`[Queue] Rejected packet ${file}: ${err.message}`);
    }
  }

  return { processed, failed };
}

module.exports = {
  processPacketQueue,
  DEFAULT_QUEUE_DIR,
  DEFAULT_PROCESSED_DIR,
};