async function generateAesKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function exportKeyBase64(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return btoa(String.fromCharCode(...raw));
}

async function importKeyBase64(base64Key) {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
}

async function encryptBytes(plainBytes) {
  const key = await generateAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes
  );

  // Pack [12-byte IV | ciphertext + GCM tag] into one buffer
  const packed = new Uint8Array(iv.length + cipherBuffer.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipherBuffer), iv.length);

  return {
    encryptedBytes: packed,
    keyBase64: await exportKeyBase64(key),
  };
}

async function decryptBytes(packedBytes, keyBase64) {
  const key = await importKeyBase64(keyBase64);
  const iv = packedBytes.slice(0, 12);
  const ciphertext = packedBytes.slice(12);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new Uint8Array(plainBuffer);
}
function hashEncryptedBytes(encryptedBytes) {
  return ethers.keccak256(encryptedBytes);
}