const SIGNING_KEY_STORAGE = "dms_signing_key_v2";
const NONCE_STORAGE = "dms_checkin_nonce_v2";
// Hardhat Account #0 (the contract owner when deployed with scripts/deploy.js)
const HARDHAT_OWNER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function getOrCreateSigningWallet() {
  let privKey = localStorage.getItem(SIGNING_KEY_STORAGE);
  if (!privKey) {
    privKey = HARDHAT_OWNER_KEY;
    localStorage.setItem(SIGNING_KEY_STORAGE, privKey);
  }
  return new ethers.Wallet(privKey);
}

function getNextCounter() {
  return Number(localStorage.getItem(NONCE_STORAGE) || "0");
}

function saveCounter(nonce) {
  localStorage.setItem(NONCE_STORAGE, String(nonce + 1));
}

async function signCheckInTypedData({ contractAddress, chainId, nonce, duress = false }) {
  const wallet = getOrCreateSigningWallet();
  const deadline = Math.floor(Date.now() / 1000) + 3600; // valid for 1 hour

  const domain = {
    name: "DeadMansSwitch",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: contractAddress,
  };

  const types = {
    CheckIn: [
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "duress", type: "bool" },
    ],
  };

  const value = {
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
    duress: Boolean(duress),
  };

  const signature = await wallet.signTypedData(domain, types, value);
  const sig = ethers.Signature.from(signature);
  const recovered = ethers.verifyTypedData(domain, types, value, signature);

  return {
    signerAddress: wallet.address,
    nonce,
    deadline,
    duress,
    v: sig.v,
    r: sig.r,
    s: sig.s,
    signature,
    verified: recovered.toLowerCase() === wallet.address.toLowerCase(),
  };
}