const encoder = new TextEncoder();
const CONSENT_PREFIX = encoder.encode('video-scissors-d-route-v1\0consent\0');
const WAKE_PREFIX = encoder.encode('video-scissors-d-route-v1\0websocket\0');
const PROJECT_RE = /^[a-f0-9]{64}$/;

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const hexToBytes = (value: string) => {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error('HEX');
  return Uint8Array.from(value.match(/.{2}/g) ?? [], byte => Number.parseInt(byte, 16));
};
const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};
const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
};
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const unbase64url = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('BASE64URL');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};
const validKey = (key: string | undefined): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key);
const cryptoKey = (hexKey: string) => crypto.subtle.importKey('raw', arrayBuffer(hexToBytes(hexKey)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sign = async (key: CryptoKey, message: Uint8Array) => new Uint8Array(await crypto.subtle.sign('HMAC', key, arrayBuffer(message)));
const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
};
const u32 = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff) throw new Error('INTEGER');
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};
const fromU32 = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);

export const isRoutingKey = validKey;
export const randomHex = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256Hex = async (value: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
export const projectForCredential = async (credential: string) => sha256Hex(credential);

export type VerifiedRouteTicket = { token: string; project: string; epoch: number; expiresAt: number };

function consentPayload(project: string, epoch: number, expiresAt: number, nonce: Uint8Array): Uint8Array {
  if (!PROJECT_RE.test(project) || !Number.isSafeInteger(epoch) || epoch < 1 || epoch > 0xffff_ffff || nonce.length !== 12) throw new Error('ROUTE_FIELDS');
  const payload = new Uint8Array(54);
  payload[0] = 1;
  payload[1] = 0; // Consent proof. Purpose is also domain-separated in the MAC.
  payload.set(hexToBytes(project), 2);
  payload.set(u32(epoch), 34);
  payload.set(u32(Math.floor(expiresAt / 1000)), 38);
  payload.set(nonce, 42);
  return payload;
}

export async function signConsentTicket(key: string, project: string, epoch: number, expiresAt: number): Promise<string> {
  if (!validKey(key)) throw new Error('ROUTING_KEY');
  const payload = consentPayload(project, epoch, expiresAt, crypto.getRandomValues(new Uint8Array(12)));
  const mac = (await sign(await cryptoKey(key), concat(CONSENT_PREFIX, payload))).slice(0, 16);
  return base64url(concat(payload, mac));
}

export async function verifyConsentTicket(key: string | undefined, token: string, now = Date.now()): Promise<VerifiedRouteTicket | null> {
  if (!validKey(key) || typeof token !== 'string' || token.length > 160) return null;
  try {
    const bytes = unbase64url(token);
    if (bytes.length !== 70 || bytes[0] !== 1 || bytes[1] !== 0) return null;
    const payload = bytes.slice(0, 54), received = bytes.slice(54);
    const project = bytesToHex(bytes.slice(2, 34)), epoch = fromU32(bytes.slice(34, 38));
    const expiresAt = fromU32(bytes.slice(38, 42)) * 1000;
    const nowSeconds = Math.floor(now / 1000);
    if (!PROJECT_RE.test(project) || epoch < 1 || expiresAt <= now || expiresAt > (nowSeconds + 300) * 1000) return null;
    const expected = (await sign(await cryptoKey(key), concat(CONSENT_PREFIX, payload))).slice(0, 16);
    return constantTimeEqual(expected, received) ? { token, project, epoch, expiresAt } : null;
  } catch { return null; }
}

function wakePayload(project: string, epoch: number, expiresAt: number, nonce: Uint8Array): Uint8Array {
  if (!PROJECT_RE.test(project) || !Number.isSafeInteger(epoch) || epoch < 1 || nonce.length !== 12) throw new Error('ROUTE_FIELDS');
  return concat(u32(Math.floor(expiresAt / 1000)), nonce);
}

export async function signWakeTicket(key: string, project: string, epoch: number, expiresAt: number): Promise<string> {
  if (!validKey(key)) throw new Error('ROUTING_KEY');
  const payload = wakePayload(project, epoch, expiresAt, crypto.getRandomValues(new Uint8Array(12)));
  const mac = (await sign(await cryptoKey(key), concat(WAKE_PREFIX, encoder.encode(`${project}\0${epoch}\0`), payload))).slice(0, 16);
  return bytesToHex(concat(payload, mac));
}

export async function verifyWakeTicket(key: string | undefined, project: string, epoch: number, token: string, now = Date.now()): Promise<VerifiedRouteTicket | null> {
  if (!validKey(key) || !PROJECT_RE.test(project) || !Number.isSafeInteger(epoch) || epoch < 1 || !/^[a-f0-9]{64}$/.test(token)) return null;
  try {
    const bytes = hexToBytes(token), payload = bytes.slice(0, 16), received = bytes.slice(16);
    const expiresAt = fromU32(payload.slice(0, 4)) * 1000, nowSeconds = Math.floor(now / 1000);
    if (expiresAt <= now || expiresAt > (nowSeconds + 60) * 1000) return null;
    const expected = (await sign(await cryptoKey(key), concat(WAKE_PREFIX, encoder.encode(`${project}\0${epoch}\0`), payload))).slice(0, 16);
    return constantTimeEqual(expected, received) ? { token, project, epoch, expiresAt } : null;
  } catch { return null; }
}
