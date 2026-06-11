import type { VisualDocument } from './types';

export interface HvyEncryptionKeyring {
  keys?: Record<string, string> | Map<string, string> | Array<[string, string]>;
}

export interface HvyEncryptionOptions extends HvyEncryptionKeyring {
  keyring?: Record<string, string> | Map<string, string> | Array<[string, string]>;
  keyId?: string;
  key?: string;
  onKeyGenerated?(key: HvyGeneratedEncryptionKey): void;
}

export interface HvyGeneratedEncryptionKey {
  keyId: string;
  key: string;
}

const FERNET_VERSION = 0x80;
const FERNET_KEY_BYTES = 32;
const FERNET_SIGNING_KEY_BYTES = 16;
const FERNET_IV_BYTES = 16;
const FERNET_HMAC_BYTES = 32;
const DOCUMENT_ENVELOPE_PREFIX = '---HVY-ENCRYPTED---\n';
const DOCUMENT_ENVELOPE_PAYLOAD = '\n---HVY-ENCRYPTED-PAYLOAD---\n';
const DOCUMENT_ENVELOPE_SUFFIX = '\n---/HVY-ENCRYPTED---\n';

export function generateFernetKey(): string {
  const bytes = new Uint8Array(FERNET_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function generateEncryptionKey(): HvyGeneratedEncryptionKey {
  return {
    keyId: crypto.randomUUID(),
    key: generateFernetKey(),
  };
}

export function getEncryptionKey(options: HvyEncryptionOptions | null | undefined, keyId: string): string | null {
  if (!options || keyId.trim().length === 0) {
    return null;
  }
  if (options.keyId === keyId && typeof options.key === 'string' && options.key.trim().length > 0) {
    return options.key;
  }
  return readKeyFromSource(options.keyring, keyId) ?? readKeyFromSource(options.keys, keyId);
}

export function rememberEncryptionKey(options: HvyEncryptionOptions | null | undefined, generated: HvyGeneratedEncryptionKey): void {
  if (options && !options.keyring && !options.keys) {
    options.keyring = {};
  }
  const keyring = options?.keyring ?? options?.keys;
  if (keyring instanceof Map) {
    keyring.set(generated.keyId, generated.key);
  } else if (Array.isArray(keyring)) {
    const existing = keyring.find((item) => item[0] === generated.keyId);
    if (existing) {
      existing[1] = generated.key;
    } else {
      keyring.push([generated.keyId, generated.key]);
    }
  } else if (keyring && typeof keyring === 'object') {
    keyring[generated.keyId] = generated.key;
  }
  options?.onKeyGenerated?.(generated);
}

export async function fernetEncryptBytes(plainBytes: Uint8Array, key: string, now = Date.now()): Promise<Uint8Array> {
  const keyBytes = decodeFernetKey(key);
  const signingKey = keyBytes.slice(0, FERNET_SIGNING_KEY_BYTES);
  const encryptionKey = keyBytes.slice(FERNET_SIGNING_KEY_BYTES);
  const iv = new Uint8Array(FERNET_IV_BYTES);
  crypto.getRandomValues(iv);
  const timestamp = Math.floor(now / 1000);
  const header = new Uint8Array(1 + 8 + FERNET_IV_BYTES);
  header[0] = FERNET_VERSION;
  writeUint64BigEndian(header, 1, timestamp);
  header.set(iv, 9);
  const cipherBytes = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(iv) },
    await crypto.subtle.importKey('raw', toArrayBuffer(encryptionKey), { name: 'AES-CBC' }, false, ['encrypt']),
    toArrayBuffer(plainBytes)
  ));
  const signedBytes = concatBytes([header, cipherBytes]);
  const hmac = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', toArrayBuffer(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    toArrayBuffer(signedBytes)
  ));
  return textEncode(base64UrlEncode(concatBytes([signedBytes, hmac])));
}

export async function fernetDecryptBytes(tokenBytes: Uint8Array, key: string): Promise<Uint8Array> {
  const keyBytes = decodeFernetKey(key);
  const signingKey = keyBytes.slice(0, FERNET_SIGNING_KEY_BYTES);
  const encryptionKey = keyBytes.slice(FERNET_SIGNING_KEY_BYTES);
  const token = base64UrlDecode(textDecode(tokenBytes).trim());
  const minimumLength = 1 + 8 + FERNET_IV_BYTES + FERNET_HMAC_BYTES + 16;
  if (token.length < minimumLength || token[0] !== FERNET_VERSION) {
    throw new Error('Invalid Fernet token.');
  }
  const hmacStart = token.length - FERNET_HMAC_BYTES;
  const signedBytes = token.slice(0, hmacStart);
  const actualHmac = token.slice(hmacStart);
  const expectedHmac = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', toArrayBuffer(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    toArrayBuffer(signedBytes)
  ));
  if (!constantTimeEqual(actualHmac, expectedHmac)) {
    throw new Error('Fernet token authentication failed.');
  }
  const iv = token.slice(9, 9 + FERNET_IV_BYTES);
  const cipherBytes = token.slice(9 + FERNET_IV_BYTES, hmacStart);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: toArrayBuffer(iv) },
    await crypto.subtle.importKey('raw', toArrayBuffer(encryptionKey), { name: 'AES-CBC' }, false, ['decrypt']),
    toArrayBuffer(cipherBytes)
  ));
}

export function isEncryptedDocumentBytes(bytes: Uint8Array): boolean {
  return textDecode(bytes.slice(0, DOCUMENT_ENVELOPE_PREFIX.length)) === DOCUMENT_ENVELOPE_PREFIX;
}

export async function encryptDocumentBytes(
  bytes: Uint8Array,
  options: { keyId?: string; key?: string } = {}
): Promise<{ bytes: Uint8Array; keyId: string; key: string }> {
  const keyId = options.keyId?.trim() || crypto.randomUUID();
  const key = options.key?.trim() || generateFernetKey();
  const tokenBytes = await fernetEncryptBytes(bytes, key);
  const header = JSON.stringify({ hvy_encryption: 1, algorithm: 'fernet', keyId });
  return {
    bytes: textEncode(`${DOCUMENT_ENVELOPE_PREFIX}${header}${DOCUMENT_ENVELOPE_PAYLOAD}${textDecode(tokenBytes)}${DOCUMENT_ENVELOPE_SUFFIX}`),
    keyId,
    key,
  };
}

export async function decryptDocumentEnvelopeBytes(bytes: Uint8Array, options: HvyEncryptionOptions | null | undefined): Promise<{ bytes: Uint8Array; keyId: string }> {
  const text = textDecode(bytes);
  if (!text.startsWith(DOCUMENT_ENVELOPE_PREFIX)) {
    return { bytes, keyId: '' };
  }
  const payloadIndex = text.indexOf(DOCUMENT_ENVELOPE_PAYLOAD);
  if (payloadIndex < 0 || !text.endsWith(DOCUMENT_ENVELOPE_SUFFIX)) {
    throw new Error('Invalid encrypted HVY envelope.');
  }
  const headerText = text.slice(DOCUMENT_ENVELOPE_PREFIX.length, payloadIndex);
  const payloadText = text.slice(payloadIndex + DOCUMENT_ENVELOPE_PAYLOAD.length, text.length - DOCUMENT_ENVELOPE_SUFFIX.length).trim();
  const header = JSON.parse(headerText) as { algorithm?: unknown; keyId?: unknown };
  if (header.algorithm !== 'fernet' || typeof header.keyId !== 'string' || header.keyId.trim().length === 0) {
    throw new Error('Invalid encrypted HVY envelope metadata.');
  }
  const key = getEncryptionKey(options, header.keyId);
  if (!key) {
    throw new Error(`Missing Fernet key for encrypted HVY document: ${header.keyId}`);
  }
  return { bytes: await fernetDecryptBytes(textEncode(payloadText), key), keyId: header.keyId };
}

export function markDocumentEncrypted(document: VisualDocument, keyId: string): void {
  document.encryption = { algorithm: 'fernet', keyId, encrypted: true };
}

function readKeyFromSource(source: HvyEncryptionOptions['keyring'], keyId: string): string | null {
  if (!source) {
    return null;
  }
  if (source instanceof Map) {
    return source.get(keyId) ?? null;
  }
  if (Array.isArray(source)) {
    return source.find(([candidate]) => candidate === keyId)?.[1] ?? null;
  }
  return typeof source[keyId] === 'string' ? source[keyId] : null;
}

function decodeFernetKey(key: string): Uint8Array {
  const bytes = base64UrlDecode(key.trim());
  if (bytes.length !== FERNET_KEY_BYTES) {
    throw new Error('Fernet key must decode to 32 bytes.');
  }
  return bytes;
}

function writeUint64BigEndian(target: Uint8Array, offset: number, value: number): void {
  let remaining = Math.max(0, Math.floor(value));
  for (let index = 7; index >= 0; index -= 1) {
    target[offset + index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function textEncode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function textDecode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
