const assert = require("assert");
const { ethers } = require("ethers");
const abi = require("./shared/DeadMansSwitch.abi.json");
const deployment = require("./shared/deployment.json");
const { createOfflineCheckInPacket, relayOfflineCheckInPacket } = require("./packetHelper");

async function runIntegrationTest() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Hardhat default Account #0 (deployer/owner) and Account #1 (relayer)
  const ownerWallet = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    provider
  );
  const relayerWallet = new ethers.Wallet(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    provider
  );

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const contractAddress = deployment.address;

  console.log("Connected to chainId:", chainId);
  console.log("Testing DeadMansSwitch at:", contractAddress);

  // Connect contract instance using the relayer account (simulates gasless owner check-in)
  const contractAsRelayer = new ethers.Contract(contractAddress, abi, relayerWallet);

  const initialNonce = Number(await contractAsRelayer.nonce());
  const block = await provider.getBlock("latest");
  const currentTimestamp = Number(block.timestamp);

  // 1. Owner signs an offline packet (nonce = 0, duress = false)
  const packet0 = await createOfflineCheckInPacket({
    wallet: ownerWallet,
    chainId,
    verifyingContract: contractAddress,
    nonce: initialNonce,
    deadline: currentTimestamp + 3600,
    duress: false,
  });

  // 2. Relayer submits packet0 on-chain
  const relayResult0 = await relayOfflineCheckInPacket({
    packetJson: packet0,
    contract: contractAsRelayer,
    expectedOwner: ownerWallet.address,
    currentTimestamp,
  });

  console.log("Tx Hash (Normal Check-In):", relayResult0.receipt.hash);
  assert.strictEqual(Number(await contractAsRelayer.nonce()), initialNonce + 1);
  assert.strictEqual(Number(await contractAsRelayer.getStage()), 0); // SAFE
  console.log("PASS 1: Offline packet relayed on-chain and nonce incremented to", initialNonce + 1);

  // 3. Replaying packet0 on-chain must revert
  await assert.rejects(async () => {
    await relayOfflineCheckInPacket({
      packetJson: packet0,
      contract: contractAsRelayer,
      expectedOwner: ownerWallet.address,
      currentTimestamp,
    });
  });
  console.log("PASS 2: On-chain replay of used packet rejected.");

  // 4. Owner signs an offline DURESS packet (nonce = 1, duress = true)
  const packet1 = await createOfflineCheckInPacket({
    wallet: ownerWallet,
    chainId,
    verifyingContract: contractAddress,
    nonce: initialNonce + 1,
    deadline: currentTimestamp + 3600,
    duress: true,
  });

  const relayResult1 = await relayOfflineCheckInPacket({
    packetJson: packet1,
    contract: contractAsRelayer,
    expectedOwner: ownerWallet.address,
    currentTimestamp,
  });

  console.log("Tx Hash (Duress Check-In):", relayResult1.receipt.hash);
  assert.strictEqual(await contractAsRelayer.duressTriggered(), true);
  assert.strictEqual(Number(await contractAsRelayer.getStage()), 0); // Still SAFE to coercer
  console.log("PASS 3: Silent duress check-in succeeded on-chain and set duressTriggered = true.");
}

runIntegrationTest().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});