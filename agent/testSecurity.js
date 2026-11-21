const assert = require("assert");
const { createBridgeServer } = require("./bridgeServer");

const mockContract = {
  getStage: async () => 0n,
  nonce: async () => 0n,
  lastCheckIn: async () => 1700000000n,
  duressTriggered: async () => false,
  released: async () => false,
  evidenceHash: async () => "0x" + "0".repeat(64),
};

async function runSecurityTests() {
  console.log("=== Day 23: HTTP Bridge Security Hardening Tests ===");

  const server = createBridgeServer({
    contract: mockContract,
    provider: {},
    authToken: "super-secret-demo-token",
    maxRequestsPerWindow: 4,
  });

  await new Promise((resolve) => server.listen(8790, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:8790";

  try {
    // 1. GET /status remains accessible for dashboard telemetry
    const statusRes = await fetch(`${baseUrl}/status`);
    assert.strictEqual(statusRes.status, 200);
    console.log("PASS 1: GET /status accessible without token (200 OK).");

    // 2. POST /relay without Bearer token must return 401
    const unauthRes = await fetch(`${baseUrl}/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: "0x1234" }),
    });
    assert.strictEqual(unauthRes.status, 401);
    console.log("PASS 2: Unauthenticated POST /relay rejected with 401 Unauthorized.");

    // 3. POST /escrow with valid Bearer token but missing fields must return 400
    const badEscrowRes = await fetch(`${baseUrl}/escrow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer super-secret-demo-token",
      },
      body: JSON.stringify({ evidenceHash: "0x1234" }),
    });
    assert.strictEqual(badEscrowRes.status, 400);
    console.log("PASS 3: Authenticated malformed POST /escrow rejected with 400 Bad Request.");

    // 4. 5th request within window must trigger 429 Too Many Requests
    await fetch(`${baseUrl}/status`); // Request #4
    const rateLimitedRes = await fetch(`${baseUrl}/status`); // Request #5
    assert.strictEqual(rateLimitedRes.status, 429);
    console.log("PASS 4: Excess request throttled with 429 Too Many Requests.");
  } finally {
    server.close();
  }
}

runSecurityTests().catch((err) => {
  console.error("Security test failed:", err);
  process.exit(1);
});