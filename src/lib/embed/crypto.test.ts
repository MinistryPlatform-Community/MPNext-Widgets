import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  seal,
  open,
  randomToken,
  sha256Hex,
  timingSafeEqualStr,
  toBase64Url,
  fromBase64Url,
  __resetCryptoKeyForTests,
} from './crypto';

const B64URL = /^[A-Za-z0-9_-]+$/;

describe('crypto - seal/open', () => {
  beforeEach(() => {
    __resetCryptoKeyForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
    vi.stubEnv('EMBED_SESSION_ENC_KEY', '');
    __resetCryptoKeyForTests();
  });

  it('round-trips a string with the derived (non-production) key', async () => {
    const sealed = await seal('hello mp token');
    expect(sealed.startsWith('v1.')).toBe(true);
    const [v, iv, ct] = sealed.split('.');
    expect(v).toBe('v1');
    expect(iv).toMatch(B64URL);
    expect(ct).toMatch(B64URL);
    expect(fromBase64Url(iv).byteLength).toBe(12);
    expect(await open(sealed)).toBe('hello mp token');
  });

  it('round-trips unicode and empty strings', async () => {
    expect(await open(await seal(''))).toBe('');
    expect(await open(await seal('héllo 🌍 ✓'))).toBe('héllo 🌍 ✓');
  });

  it('uses a fresh IV per call (same plaintext → different ciphertext)', async () => {
    const a = await seal('same');
    const b = await seal('same');
    expect(a).not.toBe(b);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });

  it('does not leak the plaintext in the sealed value', async () => {
    const sealed = await seal('super-secret-access-token');
    expect(sealed).not.toContain('super-secret-access-token');
    expect(Buffer.from(sealed.split('.')[2], 'base64url').toString()).not.toContain('super-secret');
  });

  it('throws on tampered ciphertext', async () => {
    const sealed = await seal('payload');
    const [v, iv, ct] = sealed.split('.');
    const bytes = Buffer.from(ct, 'base64url');
    bytes[0] ^= 0xff;
    const tampered = `${v}.${iv}.${bytes.toString('base64url')}`;
    await expect(open(tampered)).rejects.toThrow(/Failed to open/);
  });

  it('throws on malformed input', async () => {
    await expect(open('')).rejects.toThrow(/Invalid sealed value format/);
    await expect(open('v1.onlytwo')).rejects.toThrow(/Invalid sealed value format/);
    await expect(open('v2.aaaaaaaaaaaaaaaa.bbbb')).rejects.toThrow(/Invalid sealed value format/);
    await expect(open('v1.short.bbbb')).rejects.toThrow(/Invalid sealed value format/);
  });

  it('uses EMBED_SESSION_ENC_KEY when set and rejects values sealed under another key', async () => {
    const sealedDerived = await seal('payload');

    const key = Buffer.alloc(32, 7).toString('base64url');
    vi.stubEnv('EMBED_SESSION_ENC_KEY', key);
    __resetCryptoKeyForTests();

    const sealedExplicit = await seal('payload');
    expect(await open(sealedExplicit)).toBe('payload');
    await expect(open(sealedDerived)).rejects.toThrow(/Failed to open/);
  });

  it('rejects an EMBED_SESSION_ENC_KEY of the wrong length', async () => {
    vi.stubEnv('EMBED_SESSION_ENC_KEY', Buffer.alloc(16, 1).toString('base64url'));
    __resetCryptoKeyForTests();
    await expect(seal('x')).rejects.toThrow(/exactly 32 bytes/);
  });

  it('throws a clear error in production when EMBED_SESSION_ENC_KEY is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMBED_SESSION_ENC_KEY', '');
    __resetCryptoKeyForTests();
    await expect(seal('x')).rejects.toThrow(/EMBED_SESSION_ENC_KEY is required in production/);
    await expect(open('v1.AAAAAAAAAAAAAAAA.AAAA')).rejects.toThrow(/EMBED_SESSION_ENC_KEY is required in production/);
  });

  it('picks up a rotated derived secret without a process restart', async () => {
    const sealed = await seal('payload');
    vi.stubEnv('EMBED_JWT_SECRET', 'another-secret-that-is-long-enough-for-testing-purposes');
    await expect(open(sealed)).rejects.toThrow(/Failed to open/);
  });
});

describe('crypto - randomToken', () => {
  it('produces base64url without padding of the requested byte length', () => {
    const t32 = randomToken();
    expect(t32).toMatch(B64URL);
    expect(t32).toHaveLength(43); // ceil(32*8/6)
    expect(fromBase64Url(t32).byteLength).toBe(32);

    const t16 = randomToken(16);
    expect(t16).toHaveLength(22);
    expect(fromBase64Url(t16).byteLength).toBe(16);
  });

  it('is unique per call', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomToken()));
    expect(seen.size).toBe(50);
  });
});

describe('crypto - sha256Hex', () => {
  it('matches the known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the known vector for the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('crypto - timingSafeEqualStr', () => {
  it('returns true only for identical strings', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('', '')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('abcd', 'abc')).toBe(false);
    expect(timingSafeEqualStr('', 'a')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(timingSafeEqualStr(undefined as unknown as string, 'a')).toBe(false);
    expect(timingSafeEqualStr('a', null as unknown as string)).toBe(false);
  });
});

describe('crypto - base64url helpers', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = toBase64Url(bytes);
    expect(enc).toMatch(B64URL);
    expect(Array.from(fromBase64Url(enc))).toEqual(Array.from(bytes));
  });

  it('accepts an ArrayBuffer', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    expect(toBase64Url(buf)).toBe('AQID');
  });
});
