if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("SW registered:", reg.scope))
      .catch((err) => console.error("SW registration failed:", err));
  });
}

const RPC_STORAGE = "dms_rpc_url_v1";
const CONTRACT_STORAGE = "dms_contract_addr_v1";
const ALERT_SECONDS = 2 * 24 * 60 * 60;

const statusEl = document.getElementById("status");
const stageBadge = document.getElementById("stageBadge");
const lastCheckInText = document.getElementById("lastCheckInText");
const countdownText = document.getElementById("countdownText");

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
let lastCheckInUnix = 0;

// Restore saved chain settings
rpcInput.value = localStorage.getItem(RPC_STORAGE) || "http://127.0.0.1:8545";
contractInput.value = localStorage.getItem(CONTRACT_STORAGE) || "";
statusEl.textContent = `Ready (ethers ${ethers.version})`;

function formatDuration(sec) {
  if (sec <= 0) return "0h 0m (ALERT due)";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function updateStatusGrid(unixSec) {
  lastCheckInUnix = unixSec;
  if (!unixSec) {
    lastCheckInText.textContent = "—";
    countdownText.textContent = "—";
    return;
  }
  const date = new Date(unixSec * 1000);
  lastCheckInText.textContent = date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = unixSec + ALERT_SECONDS - nowSec;
  countdownText.textContent = formatDuration(remaining);
}

setInterval(() => {
  if (lastCheckInUnix > 0) updateStatusGrid(lastCheckInUnix);
}, 30000);

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

async function refreshContractUI() {
  const rpcUrl = rpcInput.value.trim();
  const contractAddress = contractInput.value.trim();
  if (!rpcUrl || !contractAddress) {
    statusEl.textContent = "Enter RPC URL and Contract Address";
    return;
  }

  localStorage.setItem(RPC_STORAGE, rpcUrl);
  localStorage.setItem(CONTRACT_STORAGE, contractAddress);

  try {
    statusEl.textContent = "Reading stage...";
    const { stage, lastCheckIn } = await fetchContractStage(rpcUrl, contractAddress);
    updateStageBadge(stage);
    updateStatusGrid(lastCheckIn);
    statusEl.textContent = `Connected (${stage})`;
  } catch (err) {
    console.error("Stage fetch failed:", err);
    updateStageBadge("NOT CONNECTED");
    updateStatusGrid(0);
    statusEl.textContent = "Failed to read stage — is Hardhat running?";
  }
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
  sigOutput.textContent = "(ready to sign)";
  checkInBox.classList.remove("hidden");
  statusEl.textContent = "Signing key ready";
});

refreshStageBtn.addEventListener("click", refreshContractUI);

sendCheckInBtn.addEventListener("click", async () => {
  const rpcUrl = rpcInput.value.trim();
  const contractAddress = contractInput.value.trim();
  if (!rpcUrl || !contractAddress) {
    statusEl.textContent = "Enter RPC URL and Contract Address first";
    return;
  }

  localStorage.setItem(RPC_STORAGE, rpcUrl);
  localStorage.setItem(CONTRACT_STORAGE, contractAddress);

  sendCheckInBtn.disabled = true;
  sendCheckInBtn.textContent = "Sending Check-In...";

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
    updateStatusGrid(receipt.lastCheckIn);
    signerAddressOutput.textContent = signed.signerAddress;
    sigOutput.textContent = `Counter: ${counter} | Tx: ${receipt.txHash}`;
    checkInBox.classList.remove("hidden");
    statusEl.textContent = `Check-in #${counter} confirmed (${receipt.stage})`;
  } catch (err) {
    console.error("Check-in failed:", err);
    statusEl.textContent = "Check-in failed — see console";
  } finally {
    sendCheckInBtn.disabled = false;
    sendCheckInBtn.textContent = "Check In Now";
  }
});

if (contractInput.value.trim()) {
  refreshContractUI();
}