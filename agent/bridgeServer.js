const http = require("http");
const fs = require("fs");
const path = require("path");
const { processPacketQueue, DEFAULT_QUEUE_DIR } = require("./queueRelayer");
const { saveLocalEscrow, DEFAULT_BUNDLE_PATH } = require("./releaseBuilder");

const STAGE_NAMES = {
  0: "SAFE",
  1: "ALERT",
  2: "RELEASED",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function createBridgeServer({ contract, provider, queueDir = DEFAULT_QUEUE_DIR, bundlePath = DEFAULT_BUNDLE_PATH }) {
  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      return sendJson(res, 204, {});
    }

    try {
      // 1. Live Switch Status
      if (req.method === "GET" && req.url === "/status") {
        const stageNum = Number(await contract.getStage());
        const nonce = Number(await contract.nonce());
        const lastCheckIn = Number(await contract.lastCheckIn());
        const duressTriggered = await contract.duressTriggered();
        const released = await contract.released();
        const evidenceHash = await contract.evidenceHash();

        return sendJson(res, 200, {
          stage: STAGE_NAMES[stageNum] || "UNKNOWN",
          stageCode: stageNum,
          nonce,
          lastCheckIn,
          duressTriggered,
          released,
          evidenceHash,
        });
      }

      // 2. Relay Signed Offline EIP-712 Packet from PWA
      if (req.method === "POST" && req.url === "/relay") {
        const packetObj = await readJsonBody(req);
        if (!fs.existsSync(queueDir)) {
          fs.mkdirSync(queueDir, { recursive: true });
        }

        const fileName = `bridge_${Date.now()}.json`;
        const filePath = path.join(queueDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify(packetObj, null, 2), "utf8");

        const result = await processPacketQueue({
          contract,
          provider,
          queueDir,
        });

        if (result.failed > 0 || result.processed === 0) {
          return sendJson(res, 400, {
            ok: false,
            error: "Packet rejected by pre-flight or on-chain verification",
          });
        }

        return sendJson(res, 200, {
          ok: true,
          relayed: result.processed,
          newNonce: Number(await contract.nonce()),
        });
      }

      // 3. Seed Local Key Escrow from PWA
      if (req.method === "POST" && req.url === "/escrow") {
        const body = await readJsonBody(req);
        const saved = saveLocalEscrow(body);
        return sendJson(res, 200, {
          ok: true,
          evidenceHash: saved.evidenceHash,
        });
      }

      // 4. Serve Release Bundle Only After RELEASED
      if (req.method === "GET" && req.url === "/release") {
        const stageNum = Number(await contract.getStage());
        if (stageNum !== 2) {
          return sendJson(res, 403, {
            ok: false,
            error: "Switch is not in RELEASED state yet",
          });
        }

        if (!fs.existsSync(bundlePath)) {
          return sendJson(res, 404, {
            ok: false,
            error: "Release bundle not generated yet",
          });
        }

        const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
        return sendJson(res, 200, bundle);
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  });
}

function startBridgeServer(options) {
  const port = Number(process.env.BRIDGE_PORT || 8787);
  const server = createBridgeServer(options);
  server.listen(port, "127.0.0.1", () => {
    console.log(`[Bridge] Local PWA HTTP Bridge listening on http://127.0.0.1:${port}`);
  });
  return server;
}

module.exports = { createBridgeServer, startBridgeServer };