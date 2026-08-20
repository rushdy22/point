const ALGORITHM = 'PBKDF2';
const HASH_NAME = 'SHA-256';
const ITERATIONS = 210000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function hashBranchPassword(password) {
  const value = String(password || '');
  if (value.length < 8) throw new Error('branch-password-too-short');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(value), { name: ALGORITHM }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: ALGORITHM, salt, iterations: ITERATIONS, hash: HASH_NAME }, key, DERIVED_BITS);
  return `pbkdf2-v1$${ITERATIONS}$${bufferToBase64(salt)}$${bufferToBase64(bits)}`;
}

export async function verifyBranchPassword(password, encoded) {
  try {
    const [version, iterationsRaw, saltB64, hashB64] = String(encoded || '').split('$');
    if (version !== 'pbkdf2-v1' || !saltB64 || !hashB64) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isFinite(iterations) || iterations < 100000) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password || '')), { name: ALGORITHM }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: ALGORITHM, salt: base64ToBuffer(saltB64), iterations, hash: HASH_NAME }, key, DERIVED_BITS);
    const actual = new Uint8Array(bits);
    const expected = base64ToBuffer(hashB64);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
