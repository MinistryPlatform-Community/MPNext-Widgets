// The vitest-specific entry point (what @testing-library/jest-dom documents for
// vitest): it registers the matchers on vitest's own `expect` *and* pulls in
// `types/vitest.d.ts`, which augments `Assertion` in the `vitest` module. The
// bare '@testing-library/jest-dom' entry only ships the jest namespace
// declarations, so matchers worked at runtime but failed `tsc --noEmit`.
// This file is in the root tsconfig `include`, so the augmentation is global
// to the type-check program -- do not swap it back for the bare import.
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom's TextEncoder returns a Uint8Array from a different realm than the
// global `Uint8Array`, which breaks `instanceof` checks inside `jose` (and can
// confuse WebCrypto BufferSource handling). Normalize to the global realm.
// Node's own runtime (Next.js) is unaffected; this only matters under vitest.
{
  const NativeTextEncoder = globalThis.TextEncoder;
  if (NativeTextEncoder && !(new NativeTextEncoder().encode('') instanceof Uint8Array)) {
    class RealmSafeTextEncoder extends NativeTextEncoder {
      encode(input?: string): Uint8Array<ArrayBuffer> {
        return new Uint8Array(super.encode(input));
      }
    }
    globalThis.TextEncoder = RealmSafeTextEncoder as typeof TextEncoder;
  }
}

// Mock environment variables for tests
vi.stubEnv('MINISTRY_PLATFORM_BASE_URL', 'https://test-mp.example.com');
vi.stubEnv('MINISTRY_PLATFORM_CLIENT_ID', 'test-mp-client-id');
vi.stubEnv('MINISTRY_PLATFORM_CLIENT_SECRET', 'test-mp-client-secret');
vi.stubEnv('MINISTRY_PLATFORM_SCOPE', 'http://www.thinkministry.com/dataplatform/scopes/all');
vi.stubEnv('OIDC_CLIENT_ID', 'test-client-id');
vi.stubEnv('OIDC_CLIENT_SECRET', 'test-client-secret');
vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-key-for-testing');
vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
// Embed session store: leave EMBED_SESSION_STORE_URL unset so tests use the
// in-memory store; leave EMBED_SESSION_ENC_KEY unset so the AES key derives
// from EMBED_JWT_SECRET (non-production path).
vi.stubEnv('EMBED_SESSION_STORE_URL', '');
vi.stubEnv('EMBED_SESSION_STORE_TOKEN', '');
vi.stubEnv('EMBED_SESSION_ENC_KEY', '');
vi.stubEnv('EMBED_AUTH_MODE', '');
vi.stubEnv('EMBED_AUTH_MODE_ORIGINS', '');
vi.stubEnv('NODE_ENV', 'test');
