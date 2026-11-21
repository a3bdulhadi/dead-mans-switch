const assert = require("assert");
const fs = require("fs");
const path = require("path");

function runAudit() {
  console.log("=== Day 25: Security & Release Hygiene Audit ===");

  const rootDir = path.join(__dirname, "..");
  const gitignorePath = path.join(rootDir, ".gitignore");
  assert.strictEqual(fs.existsSync(gitignorePath), true, "Root .gitignore must exist");

  const gitignore = fs.readFileSync(gitignorePath, "utf8");
  for (const pattern of [".env", "escrow.json", "release_bundle.json"]) {
    assert.strictEqual(
      gitignore.includes(pattern),
      true,
      `.gitignore must ignore ${pattern}`
    );
  }
  console.log("PASS 1: .gitignore blocks .env, escrow.json, and release_bundle.json.");

  const envExample = fs.readFileSync(path.join(__dirname, ".env.example"), "utf8");
  assert.strictEqual(
    /TELEGRAM_BOT_TOKEN=\d+:/.test(envExample),
    false,
    ".env.example must not contain a real Telegram token"
  );
  console.log("PASS 2: agent/.env.example contains no live secrets.");

  const agentDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, "shared", "deployment.json"), "utf8")
  );
  const pwaDeploymentPath = path.join(rootDir, "pwa", "shared", "deployment.json");
  if (fs.existsSync(pwaDeploymentPath)) {
    const pwaDeployment = JSON.parse(fs.readFileSync(pwaDeploymentPath, "utf8"));
    assert.strictEqual(
      agentDeployment.address,
      pwaDeployment.address,
      "Agent and PWA deployment.json addresses must match"
    );
  }
  console.log("PASS 3: Shared deployment artifacts are synchronized.");
}

try {
  runAudit();
} catch (err) {
  console.error("Audit failed:", err.message);
  process.exit(1);
}