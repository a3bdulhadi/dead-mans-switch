function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveDeliveryAesKey(privateKey, publicKey, salt, usages) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode("dms-key-delivery-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

// App side: encrypt the file's AES key for the Release Agent's P-256 public key (JWK)
async function wrapKeyForAgent(fileKeyBase64, agentPublicKeyJwk) {
  const agentPubKey = await crypto.subtle.importKey(
    "jwk",
    agentPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const deliveryKey = await deriveDeliveryAesKey(
    ephemeral.privateKey,
    agentPubKey,
    salt,
    ["encrypt"]
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    deliveryKey,
    new TextEncoder().encode(fileKeyBase64)
  );

  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey(
    "jwk",
    ephemeral.publicKey
  );

  return {
    ephemeralPublicKeyJwk,
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(ciphertext),
  };
}

// Local verification helper (mirrors what Member A's Release Agent does)
async function testKeyDeliveryRoundTrip() {
  const mockAgent = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const agentPubJwk = await crypto.subtle.exportKey("jwk", mockAgent.publicKey);

  const sampleFileKey = "dGVzdC1hZXMtMjU2LWtleS1mb3ItZG1zLWRlbW8=";
  const envelope = await wrapKeyForAgent(sampleFileKey, agentPubJwk);

  const ephPub = await crypto.subtle.importKey(
    "jwk",
    envelope.ephemeralPublicKeyJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const unwrapKey = await deriveDeliveryAesKey(
    mockAgent.privateKey,
    ephPub,
    base64ToBytes(envelope.saltBase64),
    ["decrypt"]
  );
  const recoveredBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.ivBase64) },
    unwrapKey,
    base64ToBytes(envelope.ciphertextBase64)
  );
  const recovered = new TextDecoder().decode(recoveredBuf);

  console.log("Original key:", sampleFileKey);
  console.log("Encrypted envelope:", envelope);
  console.log("Recovered key matches:", recovered === sampleFileKey);
}