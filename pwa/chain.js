const DMS_ABI = [
  "function getStage() view returns (uint8)",
  "function lastCheckIn() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function evidenceHash() view returns (bytes32)",
  "function registerEvidence(bytes32 _evidenceHash) external",
  "function checkInWithSignature(uint256 _nonce, uint256 _deadline, bool _duress, uint8 v, bytes32 r, bytes32 s) external"
];

const STAGE_NAMES = ["SAFE", "ALERT", "RELEASED"];

async function fetchContractStage(rpcUrl, contractAddress) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, DMS_ABI, provider);
  const stageNum = Number(await contract.getStage());
  const lastCheckIn = Number(await contract.lastCheckIn());
  const onChainNonce = Number(await contract.nonce());
  localStorage.setItem("dms_checkin_nonce_v2", String(onChainNonce));
  return {
    stage: STAGE_NAMES[stageNum] || "UNKNOWN",
    lastCheckIn,
    nonce: onChainNonce,
  };
}

async function registerEvidenceOnChain({ rpcUrl, contractAddress, evidenceHash }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const ownerSigner = await provider.getSigner(0);
  const contract = new ethers.Contract(contractAddress, DMS_ABI, ownerSigner);
  const tx = await contract.registerEvidence(evidenceHash);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

async function sendSignedCheckIn({ rpcUrl, contractAddress, nonce, deadline, duress, v, r, s }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const sender = await provider.getSigner(0);
  const contract = new ethers.Contract(contractAddress, DMS_ABI, sender);

  const tx = await contract.checkInWithSignature(
    BigInt(nonce),
    BigInt(deadline),
    Boolean(duress),
    v,
    r,
    s
  );
  const receipt = await tx.wait();
  const state = await fetchContractStage(rpcUrl, contractAddress);

  return {
    txHash: receipt.hash,
    stage: state.stage,
    lastCheckIn: state.lastCheckIn,
    nonce: state.nonce,
  };
}
async function fastForwardChain(rpcUrl, seconds) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  await provider.send("evm_increaseTime", [Number(seconds)]);
  await provider.send("evm_mine", []);
}