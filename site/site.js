const SITE_ABI = [
  "function getStage() view returns (uint8)",
  "function lastCheckIn() view returns (uint256)",
  "function evidenceHash() view returns (bytes32)"
];

const STAGE_NAMES = ["SAFE", "ALERT", "RELEASED"];

const stageBadge = document.getElementById("stageBadge");
const rpcInput = document.getElementById("rpcInput");
const contractInput = document.getElementById("contractInput");
const refreshBtn = document.getElementById("refreshBtn");
const lastCheckInOutput = document.getElementById("lastCheckInOutput");
const onChainHashOutput = document.getElementById("onChainHashOutput");
const fileListOutput = document.getElementById("fileListOutput");
const publishedKeyOutput = document.getElementById("publishedKeyOutput");

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
  } catch (_) {
    // Optional file; user can paste contract address manually
  }
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
    } else {
      publishedKeyOutput.textContent = "LOCKED until contract stage reaches RELEASED";
    }
  } catch (_) {
    // No release manifest published yet
  }
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
    const hash = await contract.evidenceHash();

    setStageBadge(stage);
    lastCheckInOutput.textContent = lastUnix
      ? new Date(lastUnix * 1000).toLocaleString()
      : "—";
    onChainHashOutput.textContent = hash;

    await loadReleaseManifest(stage);
  } catch (err) {
    console.error("Failed to load public site state:", err);
    setStageBadge("NOT CONNECTED");
  }
}

refreshBtn.addEventListener("click", refreshSite);

(async () => {
  await loadDeploymentDefaults();
  if (contractInput.value.trim()) {
    await refreshSite();
  }
})();