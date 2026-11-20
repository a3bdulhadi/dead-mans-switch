const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying DeadMansSwitch with account:", deployer.address);

  const DeadMansSwitch = await hre.ethers.getContractFactory("DeadMansSwitch");
  const dms = await DeadMansSwitch.deploy();
  await dms.waitForDeployment();

  const contractAddress = await dms.getAddress();
  const deploymentInfo = {
    contractName: "DeadMansSwitch",
    address: contractAddress,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  console.log("DeadMansSwitch deployed to:", contractAddress);

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
      path.join(dir, "deployment.json"),
      JSON.stringify(deploymentInfo, null, 2)
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});