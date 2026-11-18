// Codes de double authentification (TOTP, RFC 6238), compatibles Google Authenticator,
// KeePassXC et KeePassDX.

export interface OtpConfig {
  secret: Uint8Array;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
}

export function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('Clé 2FA invalide (base32 attendu).');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function parseOtp(value: string): OtpConfig | null {
  const v = value.trim();
  if (!v) return null;
  try {
    if (/^otpauth:\/\//i.test(v)) {
      const url = new URL(v);
      if (url.host.toLowerCase() !== 'totp') return null;
      const secret = url.searchParams.get('secret');
      if (!secret) return null;
      const algo = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace('-', '');
      const algorithm = algo === 'SHA256' ? 'SHA-256' : algo === 'SHA512' ? 'SHA-512' : 'SHA-1';
      const digits = Number(url.searchParams.get('digits') || 6);
      const period = Number(url.searchParams.get('period') || 30);
      return {
        secret: base32Decode(secret),
        digits: digits >= 6 && digits <= 10 ? digits : 6,
        period: period > 0 && period <= 300 ? period : 30,
        algorithm,
      };
    }
    const secret = base32Decode(v);
    if (secret.length < 5) return null;
    return { secret, digits: 6, period: 30, algorithm: 'SHA-1' };
  } catch {
    return null;
  }
}

export async function totpAt(cfg: OtpConfig, timeMs: number): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / cfg.period);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', cfg.secret as BufferSource, { name: 'HMAC', hash: cfg.algorithm }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** cfg.digits).padStart(cfg.digits, '0');
}

export async function currentTotp(cfg: OtpConfig, now = Date.now()): Promise<{ code: string; remaining: number }> {
  const code = await totpAt(cfg, now);
  const remaining = cfg.period - (Math.floor(now / 1000) % cfg.period);
  return { code, remaining };
}
