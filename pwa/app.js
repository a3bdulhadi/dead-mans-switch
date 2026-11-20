if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.error("SW registration failed:", err));
  });
}

const statusEl = document.getElementById("status");
const stageBadge = document.getElementById("stageBadge");
const fileInput = document.getElementById("fileInput");
const encryptBtn = document.getElementById("encryptBtn");
const resultBox = document.getElementById("resultBox");
const hashOutput = document.getElementById("hashOutput");
const keyOutput = document.getElementById("keyOutput");

const decryptFileInput = document.getElementById("decryptFileInput");
const decryptKeyInput = document.getElementById("decryptKeyInput");
const expectedHashInput = document.getElementById("expectedHashInput");
const decryptBtn = document.getElementById("decryptBtn");

const rpcInput = document.getElementById("rpcInput");
const contractInput = document.getElementById("contractInput");
const genKeyBtn = document.getElementById("genKeyBtn");
const refreshStageBtn = document.getElementById("refreshStageBtn");
const sendCheckInBtn = document.getElementById("sendCheckInBtn");
const checkInBox = document.getElementById("checkInBox");
const signerAddressOutput = document.getElementById("signerAddressOutput");
const sigOutput = document.getElementById("sigOutput");

const DEFAULT_CHAIN_ID = 31337;

statusEl.textContent = `Ready (ethers ${ethers.version})`;

function updateStageBadge(stage) {
  stageBadge.className = "stage-badge";
  if (stage === "SAFE") {
    stageBadge.classList.add("stage-safe");
  } else if (stage === "ALERT") {
    stageBadge.classList.add("stage-alert");
  } else if (stage === "RELEASED") {
    stageBadge.classList.add("stage-released");
  } else {
    stageBadge.classList.add("stage-unknown");
  }
  stageBadge.textContent = `STAGE: ${stage}`;
}

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
  sigOutput.textContent = "(click Sign & Send Check-In to submit on-chain)";
  checkInBox.classList.remove("hidden");
  statusEl.textContent = "Signing key ready";
});

refreshStageBtn.addEventListener("click", async () => {
  const rpcUrl = rpcInput.value.trim();
  const contractAddress = contractInput.value.trim();
  if (!rpcUrl || !contractAddress) {
    statusEl.textContent = "Enter RPC URL and Contract Address";
    return;
  }

  try {
    statusEl.textContent = "Reading stage...";
    const { stage } = await fetchContractStage(rpcUrl, contractAddress);
    updateStageBadge(stage);
    statusEl.textContent = `Contract stage: ${stage}`;
  } catch (err) {
    console.error("Stage fetch failed:", err);
    updateStageBadge("NOT CONNECTED");
    statusEl.textContent = "Failed to read stage — is Hardhat running?";
  }
});

sendCheckInBtn.addEventListener("click", async () => {
  const rpcUrl = rpcInput.value.trim();
  const contractAddress = contractInput.value.trim();
  if (!rpcUrl || !contractAddress) {
    statusEl.textContent = "Enter RPC URL and Contract Address";
    return;
  }

  try {
    statusEl.textContent = "Signing & sending check-in...";
    const counter = getNextCounter();
    const signed = await signCheckInTypedData({
      contractAddress,
      chainId: DEFAULT_CHAIN_ID,
      counter,
    });

    const receipt = await sendSignedCheckIn({
      rpcUrl,
      contractAddress,
      counter,
      signature: signed.signature,
    });

    saveCounter(counter);
    updateStageBadge(receipt.stage);
    signerAddressOutput.textContent = signed.signerAddress;
    sigOutput.textContent = `Counter: ${counter} | Tx: ${receipt.txHash}`;
    checkInBox.classList.remove("hidden");
    statusEl.textContent = `Check-in #${counter} confirmed (${receipt.stage})`;
  } catch (err) {
    console.error("Check-in failed:", err);
    statusEl.textContent = "Check-in failed — see console";
  }
});