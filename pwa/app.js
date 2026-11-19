if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.error("SW registration failed:", err));
  });
}

const statusEl = document.getElementById("status");
const fileInput = document.getElementById("fileInput");
const encryptBtn = document.getElementById("encryptBtn");
const resultBox = document.getElementById("resultBox");
const hashOutput = document.getElementById("hashOutput");
const keyOutput = document.getElementById("keyOutput");

const decryptFileInput = document.getElementById("decryptFileInput");
const decryptKeyInput = document.getElementById("decryptKeyInput");
const expectedHashInput = document.getElementById("expectedHashInput");
const decryptBtn = document.getElementById("decryptBtn");

const genKeyBtn = document.getElementById("genKeyBtn");
const signCheckInBtn = document.getElementById("signCheckInBtn");
const checkInBox = document.getElementById("checkInBox");
const signerAddressOutput = document.getElementById("signerAddressOutput");
const sigOutput = document.getElementById("sigOutput");

// Placeholder until Member A deploys DeadMansSwitch.sol to Hardhat (chainId 31337)
const DEFAULT_CHAIN_ID = 31337;
const DEFAULT_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000001";

statusEl.textContent = `Ready (ethers ${ethers.version})`;

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

encryptBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = "Pick a file to encrypt first";
    return;
  }

  try {
    statusEl.textContent = "Encrypting...";
    const plainBytes = new Uint8Array(await file.arrayBuffer());
    const { encryptedBytes, keyBase64 } = await encryptBytes(plainBytes);
    const hash = hashEncryptedBytes(encryptedBytes);

    hashOutput.textContent = hash;
    keyOutput.textContent = keyBase64;
    resultBox.classList.remove("hidden");

    downloadBytes(encryptedBytes, `${file.name}.enc`);
    statusEl.textContent = `Encrypted ${file.name} (${encryptedBytes.length} bytes)`;
  } catch (err) {
    console.error("Encryption failed:", err);
    statusEl.textContent = "Encryption failed — see console";
  }
});

decryptBtn.addEventListener("click", async () => {
  const file = decryptFileInput.files[0];
  const keyBase64 = decryptKeyInput.value.trim();
  const expectedHash = expectedHashInput.value.trim();

  if (!file || !keyBase64) {
    statusEl.textContent = "Select a .enc file and paste the AES key";
    return;
  }

  try {
    statusEl.textContent = "Verifying & decrypting...";
    const encBytes = new Uint8Array(await file.arrayBuffer());

    if (expectedHash) {
      const actualHash = hashEncryptedBytes(encBytes);
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        statusEl.textContent = "Hash mismatch! File was modified or wrong file.";
        return;
      }
    }

    const plainBytes = await decryptBytes(encBytes, keyBase64);
    const outName = file.name.endsWith(".enc")
      ? file.name.slice(0, -4)
      : `decrypted_${file.name}`;

    downloadBytes(plainBytes, outName);
    statusEl.textContent = `Decrypted ${outName} (${plainBytes.length} bytes)`;
  } catch (err) {
    console.error("Decryption failed:", err);
    statusEl.textContent = "Decryption failed: wrong key or tampered file";
  }
});

genKeyBtn.addEventListener("click", () => {
  const wallet = getOrCreateSigningWallet();
  signerAddressOutput.textContent = wallet.address;
  sigOutput.textContent = "(click Sign Typed Check-In to sign)";
  checkInBox.classList.remove("hidden");
  statusEl.textContent = "Signing key ready";
});

signCheckInBtn.addEventListener("click", async () => {
  try {
    const counter = getNextCounter();
    const res = await signCheckInTypedData({
      contractAddress: DEFAULT_CONTRACT_ADDRESS,
      chainId: DEFAULT_CHAIN_ID,
      counter,
    });
    saveCounter(counter);

    signerAddressOutput.textContent = res.signerAddress;
    sigOutput.textContent = `Counter: ${res.counter} | Verified: ${res.verified}\n${res.signature}`;
    checkInBox.classList.remove("hidden");
    statusEl.textContent = `Signed check-in #${res.counter}`;
  } catch (err) {
    console.error("Signing failed:", err);
    statusEl.textContent = "Signing failed — see console";
  }
});