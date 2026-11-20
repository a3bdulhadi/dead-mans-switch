const assert = require("assert");
const { ethers } = require("ethers");
const { createOfflineCheckInPacket, relayOfflineCheckInPacket } = require("./packetHelper");

async function runTests() {
  const ownerWallet = ethers.Wallet.createRandom();
  const fakeContractAddr = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const chainId = 31337;
  const now = Math.floor(Date.now() / 1000);

  // 1. Create an offline signed packet
  const jsonPacket = await createOfflineCheckInPacket({
    wallet: ownerWallet,
    chainId,
    verifyingContract: fakeContractAddr,
    nonce: 0,
    deadline: now + 3600,
    duress: false,
  });

  console.log("Generated Offline Check-In Packet:\n", jsonPacket);

  // 2. Mock contract instance to verify relay flow
  let submittedArgs = null;
  const mockContract = {
    checkInWithSignature: async (...args) => {
      submittedArgs = args;
      return { wait: async () => ({ status: 1, hash: "0xmocktxhash" }) };
    },
  };

  const result = await relayOfflineCheckInPacket({
    packetJson: jsonPacket,
    contract: mockContract,
    expectedOwner: ownerWallet.address,
    currentTimestamp: now + 60,
  });

  assert.strictEqual(result.recoveredSigner, ownerWallet.address);
  assert.strictEqual(submittedArgs[0], 0);
  assert.strictEqual(submittedArgs[2], false);
  console.log("PASS: Valid offline packet verified and relayed cleanly.");

  // 3. Verify expired packet is caught off-chain before gas is spent
  await assert.rejects(
    async () => {
      await relayOfflineCheckInPacket({
        packetJson: jsonPacket,
        contract: mockContract,
        expectedOwner: ownerWallet.address,
        currentTimestamp: now + 7200,
      });
    },
    /Packet expired before relay/
  );
  console.log("PASS: Expired packet rejected off-chain prior to relay.");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});