import '@testing-library/jest-dom';
import { vi } from 'vitest';

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
vi.stubEnv('NODE_ENV', 'test');
