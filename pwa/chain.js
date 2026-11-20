const DMS_ABI = [
  "function getStage() view returns (uint8)",
  "function lastCheckIn() view returns (uint256)",
  "function checkIn(uint256 counter, bytes signature) external"
];

const STAGE_NAMES = ["SAFE", "ALERT", "RELEASED"];

async function fetchContractStage(rpcUrl, contractAddress) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, DMS_ABI, provider);
  const stageNum = Number(await contract.getStage());
  const lastCheckIn = Number(await contract.lastCheckIn());
  return {
    stage: STAGE_NAMES[stageNum] || "UNKNOWN",
    lastCheckIn,
  };
}

async function sendSignedCheckIn({ rpcUrl, contractAddress, counter, signature }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const sender = await provider.getSigner(0);
  const contract = new ethers.Contract(contractAddress, DMS_ABI, sender);

  const tx = await contract.checkIn(BigInt(counter), signature);
  const receipt = await tx.wait();
  const state = await fetchContractStage(rpcUrl, contractAddress);

  return {
    txHash: receipt.hash,
    stage: state.stage,
    lastCheckIn: state.lastCheckIn,
  };
}