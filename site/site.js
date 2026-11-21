const SITE_ABI = [
  "function getStage() view returns (uint8)",
  "function lastCheckIn() view returns (uint256)",
  "function evidenceHash() view returns (bytes32)"
];

const STAGE_NAMES = ["SAFE", "ALERT", "RELEASED"];
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

const stageBadge = document.getElementById("stageBadge");
const rpcInput = document.getElementById("rpcInput");
const contractInput = document.getElementById("contractInput");
const refreshBtn = document.getElementById("refreshBtn");
const lastCheckInOutput = document.getElementById("lastCheckInOutput");
const onChainHashOutput = document.getElementById("onChainHashOutput");
const fileListOutput = document.getElementById("fileListOutput");
const publishedKeyOutput = document.getElementById("publishedKeyOutput");

const publicEncFile = document.getElementById("publicEncFile");
const publicKeyInput = document.getElementById("publicKeyInput");
const publicDecryptBtn = document.getElementById("publicDecryptBtn");
const verifyStatus = document.getElementById("verifyStatus");

let currentOnChainHash = ZERO_HASH;

function setStageBadge(stage) {
  stageBadge.className = "stage-badge";
  if (stage === "SAFE") stageBadge.classList.add("stage-safe");
  else if (stage === "ALERT") stageBadge.classList.add("stage-alert");
  else if (stage === "RELEASED") stageBadge.classList.add("stage-released");
  else stageBadge.classList.add("stage-unknown");
  stageBadge.textContent = `STAGE: ${stage}`;
}

async function loadDeploymentDefaults() {
  try {
    const res = await fetch("./shared/deployment.json");
    if (res.ok) {
      const data = await res.json();
      if (data.contractAddress) contractInput.value = data.contractAddress;
      if (data.rpcUrl) rpcInput.value = data.rpcUrl;
    }
  } catch (_) {}
}

async function loadReleaseManifest(stage) {
  try {
    const res = await fetch("./release-manifest.json");
    if (!res.ok) return;
    const manifest = await res.json();

    if (manifest.fileName && manifest.fileUrl) {
      fileListOutput.innerHTML = `<a href="${manifest.fileUrl}" download>${manifest.fileName}</a>`;
    }

    if (stage === "RELEASED" && manifest.keyBase64) {
      publishedKeyOutput.textContent = manifest.keyBase64;
      if (!publicKeyInput.value.trim()) {
        publicKeyInput.value = manifest.keyBase64;
      }
    } else {
      publishedKeyOutput.textContent = "LOCKED until contract stage reaches RELEASED";
    }
  } catch (_) {}
}

async function refreshSite() {
  const rpcUrl = rpcInput.value.trim();
  const addr = contractInput.value.trim();
  if (!rpcUrl || !addr) {
    setStageBadge("ENTER CONTRACT ADDRESS");
    return;
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(addr, SITE_ABI, provider);

    const stageNum = Number(await contract.getStage());
    const stage = STAGE_NAMES[stageNum] || "UNKNOWN";
    const lastUnix = Number(await contract.lastCheckIn());
    currentOnChainHash = await contract.evidenceHash();

    setStageBadge(stage);
    lastCheckInOutput.textContent = lastUnix
      ? new Date(lastUnix * 1000).toLocaleString()
      : "—";
    onChainHashOutput.textContent = currentOnChainHash;

    await loadReleaseManifest(stage);
  } catch (err) {
    console.error("Failed to load public site state:", err);
    setStageBadge("NOT CONNECTED");
  }
}

async function decryptAesGcm(packedBytes, base64Key) {
  const rawKey = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const iv = packedBytes.slice(0, 12);
  const ciphertext = packedBytes.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(plainBuf);
}

publicDecryptBtn.addEventListener("click", async () => {
  const file = publicEncFile.files[0];
  const keyBase64 = publicKeyInput.value.trim();

  if (!file || !keyBase64) {
    verifyStatus.textContent = "Select an .enc file and enter the Base64 key.";
    return;
  }

  try {
    verifyStatus.textContent = "Computing keccak256 hash...";
    const encBytes = new Uint8Array(await file.arrayBuffer());
    const actualHash = ethers.keccak256(encBytes);

    if (currentOnChainHash && currentOnChainHash !== ZERO_HASH) {
      if (actualHash.toLowerCase() !== currentOnChainHash.toLowerCase()) {
        verifyStatus.textContent = `HASH MISMATCH! Expected ${currentOnChainHash}, got ${actualHash}`;
        return;
      }
      verifyStatus.textContent = "Hash matches on-chain evidenceHash! Decrypting...";
    } else {
      verifyStatus.textContent = `Hash: ${actualHash} (not registered on-chain yet). Decrypting...`;
    }

    const plainBytes = await decryptAesGcm(encBytes, keyBase64);
    const outName = file.name.endsWith(".enc")
      ? file.name.slice(0, -4)
      : `decrypted_${file.name}`;

    const blob = new Blob([plainBytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outName;
    a.click();
    URL.revokeObjectURL(url);

    verifyStatus.textContent = `Verified & decrypted ${outName} (${plainBytes.length} bytes)`;
  } catch (err) {
    console.error("Public decrypt failed:", err);
    verifyStatus.textContent = "Decryption failed: wrong key or tampered file.";
  }
});

refreshBtn.addEventListener("click", refreshSite);

(async () => {
  await loadDeploymentDefaults();
  if (contractInput.value.trim()) {
    await refreshSite();
  }
})();