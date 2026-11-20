const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { saveLocalEscrow, buildReleaseBundle } = require("./releaseBuilder");

const tempEscrow = path.join(__dirname, "temp_test_escrow.json");
const tempBundle = path.join(__dirname, "temp_test_bundle.json");

try {
  const validHash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-evidence-bundle-v1"));
  const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("tampered-evidence-bundle"));

  // 1. Seed local key escrow
  saveLocalEscrow(
    {
      evidenceHash: validHash,
      keyBase64: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      ivBase64: "YWJjZGVmMTIzNDU2",
      storageUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    },
    tempEscrow
  );

  // 2. Confirm mismatched on-chain hash is rejected
  assert.throws(() => {
    buildReleaseBundle({
      contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      chainId: 31337,
      onChainEvidenceHash: wrongHash,
      escrowPath: tempEscrow,
      outputPath: tempBundle,
    });
  }, /Evidence hash mismatch/);
  console.log("PASS 1: Mismatched on-chain evidence hash rejected.");

  // 3. Confirm matching on-chain hash generates complete release bundle
  const bundle = buildReleaseBundle({
    contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    chainId: 31337,
    onChainEvidenceHash: validHash,
    releaseTxHash: "0xdeadbeef",
    escrowPath: tempEscrow,
    outputPath: tempBundle,
  });

  assert.strictEqual(bundle.status, "RELEASED");
  assert.strictEqual(bundle.evidence.keyBase64, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=");
  assert.strictEqual(fs.existsSync(tempBundle), true);
  console.log("PASS 2: Valid release bundle generated:", JSON.stringify(bundle, null, 2));
} finally {
  if (fs.existsSync(tempEscrow)) fs.unlinkSync(tempEscrow);
  if (fs.existsSync(tempBundle)) fs.unlinkSync(tempBundle);
}