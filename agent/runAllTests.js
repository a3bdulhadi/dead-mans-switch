const { execFileSync } = require("child_process");
const path = require("path");

const offlineSuites = ["testPacket.js", "testReleaseBuilder.js"];
const liveNodeSuites = [
  "integrationTest.js",
  "testQueueRelayer.js",
  "testBridge.js",
  "testWatcher.js",
];

function runScript(scriptName) {
  const fullPath = path.join(__dirname, scriptName);
  console.log(`\n>>> Running ${scriptName} ...`);
  execFileSync(process.execPath, [fullPath], { stdio: "inherit" });
}

function main() {
  const mode = process.argv[2] || "all";

  console.log("=== Dead Man's Switch Agent Test Suite ===");

  for (const script of offlineSuites) {
    runScript(script);
  }

  if (mode === "offline") {
    console.log("\nALL OFFLINE AGENT TESTS PASSED!");
    return;
  }

  for (const script of liveNodeSuites) {
    runScript(script);
  }

  console.log("\nALL WEEK 3 AGENT TESTS PASSED!");
}

try {
  main();
} catch (err) {
  console.error("\nAgent test suite failed!");
  process.exit(1);
}