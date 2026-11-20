const fs = require("fs");
const path = require("path");

async function main() {
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "DeadMansSwitch.sol",
    "DeadMansSwitch.json"
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error("Compiled artifact not found. Run 'npx hardhat compile' first.");
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  // Canonical EIP-712 typed-data definition matching DeadMansSwitch.sol
  const eip712Schema = {
    domainTemplate: {
      name: "DeadMansSwitch",
      version: "1",
      // chainId and verifyingContract are populated at runtime per deployment
    },
    primaryType: "CheckIn",
    types: {
      CheckIn: [
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "duress", type: "bool" },
      ],
    },
    stages: {
      0: "SAFE",
      1: "ALERT",
      2: "RELEASED",
    },
    thresholdsSeconds: {
      alert: 2 * 24 * 60 * 60,   // 172800 (2 days)
      release: 5 * 24 * 60 * 60, // 432000 (5 days)
    },
  };

  // Export targets: agent/ and pwa/ (plus site/ if it exists)
  const rootDir = path.join(__dirname, "..", "..");
  const targetDirs = [
    path.join(rootDir, "agent", "shared"),
    path.join(rootDir, "pwa", "shared"),
  ];

  const siteDir = path.join(rootDir, "site");
  if (fs.existsSync(siteDir)) {
    targetDirs.push(path.join(siteDir, "shared"));
  }

  for (const dir of targetDirs) {
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, "DeadMansSwitch.abi.json"),
      JSON.stringify(artifact.abi, null, 2)
    );

    fs.writeFileSync(
      path.join(dir, "eip712Schema.json"),
      JSON.stringify(eip712Schema, null, 2)
    );

    console.log("Exported ABI & EIP-712 schema to:", dir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});