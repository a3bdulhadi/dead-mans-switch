const ENCRYPTED_WALLET_STORAGE = "dms_encrypted_wallet_v1";
const LEGACY_KEY_STORAGE = "dms_signing_key_v2";
const NONCE_STORAGE = "dms_checkin_nonce_v2";
const HARDHAT_OWNER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

let unlockedWallet = null;

function isWalletUnlocked() {
  return unlockedWallet !== null;
}

function hasEncryptedWallet() {
  return Boolean(localStorage.getItem(ENCRYPTED_WALLET_STORAGE));
}

async function deriveKeyFromPassphrase(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations: 200000,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function lockAndSaveWallet(passphrase) {
  if (!passphrase || passphrase.length < 6) {
    throw new Error("Passphrase must be at least 6 characters");
  }
  const privKey = unlockedWallet
    ? unlockedWallet.privateKey
    : localStorage.getItem(LEGACY_KEY_STORAGE) || HARDHAT_OWNER_KEY;

  const wallet = new ethers.Wallet(privKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveKeyFromPassphrase(passphrase, salt);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(wallet.privateKey)
  );

  localStorage.setItem(
    ENCRYPTED_WALLET_STORAGE,
    JSON.stringify({
      address: wallet.address,
      salt: btoa(String.fromCharCode(...salt)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(cipherBuf))),
    })
  );
  localStorage.removeItem(LEGACY_KEY_STORAGE);
  unlockedWallet = wallet;
  return wallet.address;
}

async function unlockWallet(passphrase) {
  const raw = localStorage.getItem(ENCRYPTED_WALLET_STORAGE);
  if (!raw) {
    throw new Error("No encrypted key saved — click Lock Key first");
  }
  const data = JSON.parse(raw);
  const salt = Uint8Array.from(atob(data.salt), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(data.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(data.ciphertext), (c) => c.charCodeAt(0));

  const aesKey = await deriveKeyFromPassphrase(passphrase, salt);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext
    );
    const privKey = new TextDecoder().decode(plainBuf);
    unlockedWallet = new ethers.Wallet(privKey);
    return unlockedWallet.address;
  } catch (_) {
    throw new Error("Wrong passphrase");
  }
}

function getOrCreateSigningWallet() {
  if (unlockedWallet) return unlockedWallet;
  const legacy = localStorage.getItem(LEGACY_KEY_STORAGE);
  if (legacy && !hasEncryptedWallet()) {
    return new ethers.Wallet(legacy);
  }
  return null;
}

function getNextCounter() {
  return Number(localStorage.getItem(NONCE_STORAGE) || "0");
}

function saveCounter(nonce) {
  localStorage.setItem(NONCE_STORAGE, String(nonce + 1));
}

async function signCheckInTypedData({ contractAddress, chainId, nonce, duress = false }) {
  const wallet = getOrCreateSigningWallet();
  if (!wallet) {
    throw new Error("Signing key is locked — unlock it in Chain Settings");
  }
  const deadline = Math.floor(Date.now() / 1000) + 3600;

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