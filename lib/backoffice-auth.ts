// Backoffice sessiyasi: imzolangan (HMAC-SHA256) HttpOnly cookie.
// Web Crypto ishlatiladi — kod middleware (edge runtime) va route handler (Node) da bir xil ishlaydi.
// Sozlamalar muhit o'zgaruvchilaridan (serverda app.js ularni backoffice.env dan yuklaydi):
//   BACKOFFICE_USER, BACKOFFICE_PASSWORD, BACKOFFICE_SESSION_SECRET

export const SESSION_COOKIE = 'clamo_bo_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface BackofficeConfig {
  user: string;
  password: string;
  secret: string;
}

// Parol sozlanmagan bo'lsa null — backoffice yopiq bo'ladi
export function getBackofficeConfig(): BackofficeConfig | null {
  const password = process.env.BACKOFFICE_PASSWORD;
  if (!password) return null;
  return {
    user: process.env.BACKOFFICE_USER || 'admin',
    password,
    // Alohida maxfiy kalit bo'lmasa paroldan foydalaniladi: parol almashsa eski sessiyalar bekor bo'ladi
    secret: process.env.BACKOFFICE_SESSION_SECRET || password,
  };
}

// Vaqt bo'yicha sizib chiqishsiz taqqoslash
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

async function sign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

export async function createSessionToken(config: BackofficeConfig): Promise<string> {
  const payload = `${config.user}:${Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS}`;
  return `${toBase64Url(new TextEncoder().encode(payload))}.${await sign(config.secret, payload)}`;
}

export async function verifySessionToken(token: string | undefined, config: BackofficeConfig): Promise<boolean> {
  if (!token) return false;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;
  try {
    const payload = fromBase64Url(encodedPayload);
    const [user, exp] = payload.split(':');
    if (!safeEqual(user, config.user) || !(Number(exp) > Date.now() / 1000)) return false;
    return safeEqual(signature, await sign(config.secret, payload));
  } catch {
    return false;
  }
}

// Login'dan keyin faqat backoffice ichidagi nisbiy manzilga qaytariladi (open redirect'ning oldini olish)
export function safeNextPath(next: string | null | undefined): string {
  return next && /^\/backoffice(\/|\?|$)/.test(next) && !next.startsWith('/backoffice/login') ? next : '/backoffice';
}
