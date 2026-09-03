// E2E encryption (client-side AES-GCM). Server stores .enc blobs, never sees plaintext.
// Key derived from user PIN via PBKDF2 (SHA-256, 100k iterations). Key never leaves device.

async function deriveKey(pin: string, saltB64: string): Promise<CryptoKey> {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode('tg-drive:' + pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export function getSalt(): string {
  let s = localStorage.getItem('enc_salt');
  if (!s) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    s = btoa(String.fromCharCode(...b));
    localStorage.setItem('enc_salt', s);
  }
  return s;
}

export function isEncryptionEnabled(): boolean {
  return localStorage.getItem('encryption_enabled') === '1';
}
export function setEncryptionEnabled(v: boolean) {
  localStorage.setItem('encryption_enabled', v ? '1' : '0');
}

export async function encryptFile(pin: string, data: ArrayBuffer): Promise<{ blob: Blob; ivB64: string }> {
  const key = await deriveKey(pin, getSalt());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const ivB64 = btoa(String.fromCharCode(...iv));
  return { blob: new Blob([ct], { type: 'application/octet-stream' }), ivB64 };
}

export async function decryptFile(pin: string, ivB64: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await deriveKey(pin, getSalt());
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data) as Promise<ArrayBuffer>;
}

// filename convention: original name stored as "<name>.enc#<ivB64>" in Telegram caption is lossy,
// so we store iv in file_tags-like sidecar: localStorage map + Supabase file_tags tag "enc:<iv>".
export function encName(name: string): string { return name.endsWith('.enc') ? name : name + '.enc'; }
export function parseEncName(name: string): { base: string; encrypted: boolean } {
  return name.endsWith('.enc') ? { base: name.slice(0, -4), encrypted: true } : { base: name, encrypted: false };
}
