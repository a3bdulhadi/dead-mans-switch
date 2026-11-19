const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying DeadMansSwitch with account:", deployer.address);

  const DeadMansSwitch = await hre.ethers.getContractFactory("DeadMansSwitch");
  const dms = await DeadMansSwitch.deploy();
  await dms.waitForDeployment();

  const contractAddress = await dms.getAddress();
  console.log("DeadMansSwitch deployed to:", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});