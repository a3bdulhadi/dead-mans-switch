const PIN_STORAGE = "dms_pin_hashes_v1";
const PBKDF2_ITERS = 200000;

async function stretchPin(pin, saltBase64) {
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
  const keyMat = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERS },
    keyMat,
    256
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function ensureDefaultPins() {
  if (localStorage.getItem(PIN_STORAGE)) return;
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = btoa(String.fromCharCode(...saltBytes));
  const normalHash = await stretchPin("1234", saltBase64);
  const duressHash = await stretchPin("9999", saltBase64);
  localStorage.setItem(
    PIN_STORAGE,
    JSON.stringify({
      saltBase64,
      normalHex: Array.from(normalHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
      duressHex: Array.from(duressHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
    })
  );
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function verifyPin(pin) {
  await ensureDefaultPins();
  const stored = JSON.parse(localStorage.getItem(PIN_STORAGE));
  const candidate = await stretchPin(pin, stored.saltBase64);
  const isNormal = constantTimeEqual(candidate, hexToBytes(stored.normalHex));
  const isDuress = constantTimeEqual(candidate, hexToBytes(stored.duressHex));
  if (isDuress) return "duress";
  if (isNormal) return "normal";
  return "invalid";
}

ensureDefaultPins();