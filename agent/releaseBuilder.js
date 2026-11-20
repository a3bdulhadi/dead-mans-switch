const fs = require("fs");
const path = require("path");

const DEFAULT_ESCROW_PATH = path.join(__dirname, "escrow.json");
const DEFAULT_BUNDLE_PATH = path.join(__dirname, "release_bundle.json");

/**
 * Seeds a local key-escrow file matching the AES-256-GCM parameters
 * used by Member B's pwa/keydelivery.js.
 */
function saveLocalEscrow(
  { evidenceHash, keyBase64, ivBase64, storageUri, algorithm = "AES-256-GCM" },
  escrowPath = DEFAULT_ESCROW_PATH
) {
  if (!evidenceHash || !keyBase64 || !ivBase64 || !storageUri) {
    throw new Error("Missing required escrow fields (evidenceHash, keyBase64, ivBase64, storageUri)");
  }

  const record = {
    version: "1",
    algorithm,
    evidenceHash,
    keyBase64,
    ivBase64,
    storageUri,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(escrowPath, JSON.stringify(record, null, 2), "utf8");
  return record;
}

/**
 * Verifies the local escrow against the on-chain evidenceHash and builds
 * the public release bundle once the smart contract is permanently RELEASED.
 */
function buildReleaseBundle({
  contractAddress,
  chainId,
  onChainEvidenceHash,
  releaseTxHash = null,
  escrowPath = DEFAULT_ESCROW_PATH,
  outputPath = DEFAULT_BUNDLE_PATH,
}) {
  if (!fs.existsSync(escrowPath)) {
    throw new Error(`Escrow file not found at ${escrowPath}`);
  }

  const escrow = JSON.parse(fs.readFileSync(escrowPath, "utf8"));

  // Enforce strict cryptographic binding between on-chain hash and local key escrow
  if (escrow.evidenceHash.toLowerCase() !== onChainEvidenceHash.toLowerCase()) {
    throw new Error(
      `Evidence hash mismatch! On-chain: ${onChainEvidenceHash}, Escrow: ${escrow.evidenceHash}`
    );
  }

  const bundle = {
    status: "RELEASED",
    releasedAt: new Date().toISOString(),
    contract: {
      address: contractAddress,
      chainId: Number(chainId),
      releaseTxHash,
    },
    evidence: {
      evidenceHash: onChainEvidenceHash,
      storageUri: escrow.storageUri,
      algorithm: escrow.algorithm || "AES-256-GCM",
      keyBase64: escrow.keyBase64,
      ivBase64: escrow.ivBase64,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2), "utf8");
  return bundle;
}

module.exports = {
  saveLocalEscrow,
  buildReleaseBundle,
  DEFAULT_ESCROW_PATH,
  DEFAULT_BUNDLE_PATH,
};