const SIGNING_KEY_STORAGE = "dms_signing_key_v1";
const COUNTER_STORAGE = "dms_checkin_counter_v1";

function getOrCreateSigningWallet() {
  let privKey = localStorage.getItem(SIGNING_KEY_STORAGE);
  if (!privKey) {
    const wallet = ethers.Wallet.createRandom();
    privKey = wallet.privateKey;
    localStorage.setItem(SIGNING_KEY_STORAGE, privKey);
  }
  return new ethers.Wallet(privKey);
}

function getNextCounter() {
  const current = Number(localStorage.getItem(COUNTER_STORAGE) || "0");
  return current + 1;
}

function saveCounter(counter) {
  localStorage.setItem(COUNTER_STORAGE, String(counter));
}

async function signCheckInTypedData({ contractAddress, chainId, counter }) {
  const wallet = getOrCreateSigningWallet();

  const domain = {
    name: "DeadMansSwitch",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: contractAddress,
  };

  const types = {
    CheckIn: [{ name: "counter", type: "uint256" }],
  };

  const value = {
    counter: BigInt(counter),
  };

  const signature = await wallet.signTypedData(domain, types, value);
  const recovered = ethers.verifyTypedData(domain, types, value, signature);

  return {
    signerAddress: wallet.address,
    counter,
    domain,
    signature,
    verified: recovered.toLowerCase() === wallet.address.toLowerCase(),
  };
}