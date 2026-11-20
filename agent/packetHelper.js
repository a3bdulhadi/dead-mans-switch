const { ethers } = require("ethers");

// EIP-712 Types matching DeadMansSwitch.sol exactly
const CHECKIN_TYPES = {
  CheckIn: [
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "duress", type: "bool" },
  ],
};

/**
 * Builds the EIP-712 domain object for a deployed DeadMansSwitch instance.
 */
function buildDomain(chainId, verifyingContract) {
  return {
    name: "DeadMansSwitch",
    version: "1",
    chainId: Number(chainId),
    verifyingContract,
  };
}

/**
 * Signs an offline check-in packet using an ethers Wallet/Signer and returns
 * a portable JSON string suitable for local queue storage or QR/file relay.
 */
async function createOfflineCheckInPacket({
  wallet,
  chainId,
  verifyingContract,
  nonce,
  deadline,
  duress = false,
}) {
  if (!ethers.isAddress(verifyingContract)) {
    throw new Error("Invalid verifyingContract address");
  }

  const domain = buildDomain(chainId, verifyingContract);
  const value = {
    nonce: Number(nonce),
    deadline: Number(deadline),
    duress: Boolean(duress),
  };

  const signature = await wallet.signTypedData(domain, CHECKIN_TYPES, value);
  const { v, r, s } = ethers.Signature.from(signature);

  const packet = {
    version: "1",
    chainId: Number(chainId),
    verifyingContract,
    payload: value,
    signature: { v, r, s },
  };

  return JSON.stringify(packet, null, 2);
}

/**
 * Parses and validates an exported JSON check-in packet, verifies the signer
 * locally before spending gas, and submits it to the DeadMansSwitch contract.
 */
async function relayOfflineCheckInPacket({
  packetJson,
  contract,
  expectedOwner,
  currentTimestamp = Math.floor(Date.now() / 1000),
}) {
  const packet = typeof packetJson === "string" ? JSON.parse(packetJson) : packetJson;

  if (!packet || !packet.payload || !packet.signature || !packet.verifyingContract) {
    throw new Error("Malformed check-in packet");
  }

  const { nonce, deadline, duress } = packet.payload;
  const { v, r, s } = packet.signature;

  if (currentTimestamp > deadline) {
    throw new Error("Packet expired before relay");
  }

  // Verify signature off-chain first so relayers never waste gas on invalid packets
  const domain = buildDomain(packet.chainId, packet.verifyingContract);
  const reconstructedSig = ethers.Signature.from({ v, r, s }).serialized;
  const recovered = ethers.verifyTypedData(domain, CHECKIN_TYPES, packet.payload, reconstructedSig);

  if (expectedOwner && recovered.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`Signer mismatch: expected ${expectedOwner}, got ${recovered}`);
  }

  // Submit transaction on-chain via the relayer's connected contract instance
  const tx = await contract.checkInWithSignature(nonce, deadline, duress, v, r, s);
  const receipt = await tx.wait();
  return { receipt, recoveredSigner: recovered };
}

module.exports = {
  CHECKIN_TYPES,
  buildDomain,
  createOfflineCheckInPacket,
  relayOfflineCheckInPacket,
};