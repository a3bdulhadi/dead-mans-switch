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
const queueText = document.getElementById("queueText");
const syncQueueBtn = document.getElementById("syncQueueBtn");

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

async function refreshQueueCount() {
  const items = await getPendingCheckIns();
  queueText.textContent = `Queued: ${items.length}`;
  return items;
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
    statusEl.textContent = "Offline or Hardhat not running";
  }
}

async function syncPendingQueue() {
  const items = await getPendingCheckIns();
  if (items.length === 0) {
    statusEl.textContent = "Queue is empty";
    return;
  }

  syncQueueBtn.disabled = true;
  let synced = 0;

  try {
    for (const item of items) {
      if (!item.r || !item.s || item.v === undefined) {
        await removePendingCheckIn(item.id);
        continue;
      }
      statusEl.textContent = `Syncing queued check-in #${item.nonce}...`;
      const receipt = await sendSignedCheckIn(item);
      await removePendingCheckIn(item.id);
      synced += 1;
      updateStageBadge(receipt.stage);
      updateStatusGrid(receipt.lastCheckIn);
      sigOutput.textContent = `Synced nonce ${item.nonce} | Tx: ${receipt.txHash}`;
      checkInBox.classList.remove("hidden");
    }
    statusEl.textContent = `Synced ${synced} queued check-in(s)`;
  } catch (err) {
    console.error("Queue sync failed:", err);
    statusEl.textContent = `Synced ${synced}, remaining stay queued`;
  } finally {
    await refreshQueueCount();
    syncQueueBtn.disabled = false;
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
syncQueueBtn.addEventListener("click", syncPendingQueue);
window.addEventListener("online", syncPendingQueue);

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
  sendCheckInBtn.textContent = "Signing Check-In...";

  try {
    const nonce = getNextCounter();
    const signed = await signCheckInTypedData({
      contractAddress,
      chainId: DEFAULT_CHAIN_ID,
      nonce,
      duress: false,
    });
    saveCounter(nonce);

    signerAddressOutput.textContent = signed.signerAddress;
    checkInBox.classList.remove("hidden");

    const payload = {
      rpcUrl,
      contractAddress,
      nonce: signed.nonce,
      deadline: signed.deadline,
      duress: signed.duress,
      v: signed.v,
      r: signed.r,
      s: signed.s,
    };

    if (!navigator.onLine) {
      await enqueueCheckIn(payload);
      await refreshQueueCount();
      sigOutput.textContent = `Queued offline (nonce ${nonce})`;
      statusEl.textContent = `Offline — check-in (nonce ${nonce}) queued in IndexedDB`;
      return;
    }

    try {
      sendCheckInBtn.textContent = "Sending Check-In...";
      const receipt = await sendSignedCheckIn(payload);
      updateStageBadge(receipt.stage);
      updateStatusGrid(receipt.lastCheckIn);
      sigOutput.textContent = `Nonce: ${nonce} | Tx: ${receipt.txHash}`;
      statusEl.textContent = `Check-in (nonce ${nonce}) confirmed (${receipt.stage})`;
    } catch (netErr) {
      await enqueueCheckIn(payload);
      await refreshQueueCount();
      sigOutput.textContent = `Queued offline (nonce ${nonce})`;
      statusEl.textContent = `Chain unreachable — check-in (nonce ${nonce}) queued`;
    }
  } catch (err) {
    console.error("Check-in error:", err);
    statusEl.textContent = "Check-in failed — see console";
  } finally {
    sendCheckInBtn.disabled = false;
    sendCheckInBtn.textContent = "Check In Now";
  }
});

refreshQueueCount();
if (contractInput.value.trim()) {
  refreshContractUI();
}
const wizardFileInput = document.getElementById("wizardFileInput");
const agentKeyInput = document.getElementById("agentKeyInput");
const runWizardBtn = document.getElementById("runWizardBtn");
const wizardBox = document.getElementById("wizardBox");
const wizardOutput = document.getElementById("wizardOutput");

runWizardBtn.addEventListener("click", async () => {
  const file = wizardFileInput.files[0];
  const rpcUrl = rpcInput.value.trim();
  const contractAddress = contractInput.value.trim();

  wizardOutput.classList.remove("wizard-ok", "wizard-err");

  if (!file) {
    statusEl.textContent = "Pick an evidence file for the Setup Wizard";
    return;
  }
  if (file.size === 0) {
    statusEl.textContent = "Selected file is empty (0 bytes)";
    return;
  }
  if (!rpcUrl || !contractAddress) {
    statusEl.textContent = "Enter RPC URL and Contract Address first";
    return;
  }

  let agentPubJwk = null;
  const rawJwk = agentKeyInput.value.trim();
  if (rawJwk) {
    try {
      agentPubJwk = JSON.parse(rawJwk);
      if (agentPubJwk.kty !== "EC" || agentPubJwk.crv !== "P-256") {
        throw new Error("Expected an EC P-256 JWK");
      }
    } catch (parseErr) {
      wizardBox.classList.remove("hidden");
      wizardOutput.classList.add("wizard-err");
      wizardOutput.textContent = "Invalid Agent Public Key JWK — check the JSON format.";
      statusEl.textContent = "Invalid Agent Public Key JWK";
      return;
    }
  }

  runWizardBtn.disabled = true;
  runWizardBtn.textContent = "Running Setup...";
  wizardBox.classList.remove("hidden");
  const log = [];

  try {
    // 1. Encrypt evidence
    statusEl.textContent = "Wizard 1/4: Encrypting file...";
    const plainBytes = new Uint8Array(await file.arrayBuffer());
    const { encryptedBytes, keyBase64 } = await encryptBytes(plainBytes);
    const hash = hashEncryptedBytes(encryptedBytes);
    log.push(`1. Encrypted (${encryptedBytes.length} bytes)`);
    log.push(`   Hash: ${hash}`);

    // 2. Wrap key for Release Agent (ECDH + HKDF + AES-GCM)
    statusEl.textContent = "Wizard 2/4: Wrapping key...";
    if (!agentPubJwk) {
      const tempAgent = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
      );
      agentPubJwk = await crypto.subtle.exportKey("jwk", tempAgent.publicKey);
    }
    const envelope = await wrapKeyForAgent(keyBase64, agentPubJwk);
    log.push("2. Wrapped AES key (ECDH+HKDF+AES-GCM)");

    // 3. Store evidence hash on-chain
    statusEl.textContent = "Wizard 3/4: Storing hash on contract...";
    try {
      const { txHash } = await registerEvidenceOnChain({
        rpcUrl,
        contractAddress,
        evidenceHash: hash,
      });
      log.push(`3. Hash stored on-chain (Tx: ${txHash})`);
    } catch (chainErr) {
      throw new Error("Could not store hash on-chain — is Hardhat running?");
    }

    // 4. Download .enc file and wrapped-key.json
    statusEl.textContent = "Wizard 4/4: Downloading files...";
    downloadBytes(encryptedBytes, `${file.name}.enc`);
    const wrappedJson = new TextEncoder().encode(
      JSON.stringify({ fileName: `${file.name}.enc`, evidenceHash: hash, envelope }, null, 2)
    );
    downloadBytes(wrappedJson, "wrapped-key.json");
    log.push(`4. Downloaded ${file.name}.enc + wrapped-key.json`);

    wizardOutput.classList.add("wizard-ok");
    wizardOutput.textContent = log.join("\n");
    statusEl.textContent = "Setup Wizard complete!";
  } catch (err) {
    console.error("Setup Wizard failed:", err);
    log.push(`Error: ${err.message || err}`);
    wizardOutput.classList.add("wizard-err");
    wizardOutput.textContent = log.join("\n");
    statusEl.textContent = err.message || "Setup Wizard failed";
  } finally {
    runWizardBtn.disabled = false;
    runWizardBtn.textContent = "Run Setup Wizard";
  }
});