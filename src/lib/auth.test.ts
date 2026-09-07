import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseUserInput,
  parseAdditionalUserInputFromProviderProfile,
} from 'better-auth/db';
import type { BetterAuthOptions } from 'better-auth';
import { auth } from '@/lib/auth';
import {
  captureMpProfile,
  getCapturedMpProfile,
  runWithMpProfileCapture,
} from '@/lib/auth-profile-capture';

/**
 * Regression cover for the silent loss of `userGuid` / `imageGuid` from the
 * Better Auth session after an MP OAuth sign-in.
 *
 * Root cause: both fields are declared `input: false` (they are authorization
 * inputs -- `checkDemoAccess` resolves `userGuid` to a `dp_Users.User_ID`), and
 * Better Auth strips exactly those fields out of the provider profile before
 * building the user row. `mapProfileToUser` therefore ran, produced the right
 * values, and had them thrown away with nothing logged.
 *
 * The fix routes the values through a request-scoped capture into
 * `databaseHooks.user.create/update.before`, which writes them onto the record
 * directly. These tests pin all three halves of that: the upstream behaviour
 * that makes the hook necessary, the hook itself, and the security property
 * (still unsettable by a client) that `input: false` buys us.
 */

const getTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords(...args: unknown[]) {
      return getTableRecords(...args);
    }
  },
}));

// `auth.options` is the exact object Better Auth parses input against, so the
// input-filter assertions below run against real production config.
const options = auth.options as unknown as BetterAuthOptions;

type MpProviderConfig = {
  overrideUserInfo?: boolean;
  mapProfileToUser?: (profile: Record<string, unknown>) => Promise<unknown>;
};

function mpProviderConfig(): MpProviderConfig {
  const plugin = (options.plugins ?? []).find((p) => p.id === 'generic-oauth');
  expect(plugin).toBeDefined();
  return (plugin as unknown as { options: { config: MpProviderConfig[] } })
    .options.config[0];
}

function userHooks() {
  const hooks = options.databaseHooks?.user;
  expect(hooks?.create?.before).toBeTypeOf('function');
  expect(hooks?.update?.before).toBeTypeOf('function');
  return hooks as NonNullable<typeof hooks>;
}

describe('better-auth user schema: userGuid / imageGuid', () => {
  it('declares both fields non-writable from input', () => {
    const fields = options.user?.additionalFields ?? {};
    expect(fields.userGuid?.input).toBe(false);
    expect(fields.imageGuid?.input).toBe(false);
  });

  it('rejects a client attempt to set userGuid through updateUser', () => {
    expect(() =>
      parseUserInput(options, { userGuid: 'attacker-controlled-guid' }, 'update'),
    ).toThrowError(/not allowed to be set/i);
  });

  it('rejects a client attempt to set userGuid at sign-up', () => {
    expect(() =>
      parseUserInput(options, { userGuid: 'attacker-controlled-guid' }, 'create'),
    ).toThrowError(/not allowed to be set/i);
  });

  it('rejects a client attempt to set imageGuid', () => {
    expect(() =>
      parseUserInput(options, { imageGuid: 'attacker-controlled-guid' }, 'update'),
    ).toThrowError(/not allowed to be set/i);
  });

  it('still drops both fields when they arrive on the provider profile', () => {
    // This is the bug. If a future better-auth stops stripping `input: false`
    // fields here, this test fails and the database hooks become redundant --
    // at which point `mapProfileToUser` must NOT start returning them again,
    // because `parseInputData` throws on a truthy `input: false` value.
    const parsed = parseAdditionalUserInputFromProviderProfile(
      options,
      { userGuid: 'guid-from-mp', imageGuid: 'image-from-mp' },
      'create',
    );
    expect(parsed).toEqual({});
  });
});

describe('runWithMpProfileCapture', () => {
  it('keeps the captured profile scoped to one request', async () => {
    const seen: Array<string | null> = [];

    await Promise.all([
      runWithMpProfileCapture(async () => {
        captureMpProfile({ userGuid: 'guid-a', imageGuid: 'img-a' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(getCapturedMpProfile()?.userGuid ?? null);
      }),
      runWithMpProfileCapture(async () => {
        captureMpProfile({ userGuid: 'guid-b', imageGuid: 'img-b' });
        seen.push(getCapturedMpProfile()?.userGuid ?? null);
      }),
    ]);

    expect(seen.sort()).toEqual(['guid-a', 'guid-b']);
  });

  it('reads back nothing outside a capture scope', () => {
    expect(getCapturedMpProfile()).toBeNull();
  });

  it('warns instead of leaking when captured outside a scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    captureMpProfile({ userGuid: 'guid-orphan', imageGuid: null });
    expect(getCapturedMpProfile()).toBeNull();
    expect(warn).toHaveBeenCalled();
    // The GUID is an authorization input: never log its value.
    expect(warn.mock.calls.flat().join(' ')).not.toContain('guid-orphan');
    warn.mockRestore();
  });
});

describe('databaseHooks.user populate userGuid / imageGuid', () => {
  beforeEach(() => {
    getTableRecords.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create.before writes the captured MP identity onto the new row', async () => {
    const hooks = userHooks();
    const result = await runWithMpProfileCapture(async () => {
      captureMpProfile({ userGuid: 'guid-1', imageGuid: 'image-1' });
      return hooks.create!.before!(
        { id: 'u1', email: 'a@example.com' } as never,
        null,
      );
    });

    expect(result).toEqual({
      data: { userGuid: 'guid-1', imageGuid: 'image-1' },
    });
  });

  it('update.before refreshes an existing row on re-sign-in', async () => {
    const hooks = userHooks();
    const result = await runWithMpProfileCapture(async () => {
      captureMpProfile({ userGuid: 'guid-2', imageGuid: null });
      return hooks.update!.before!({ name: 'Ada' } as never, null);
    });

    expect(result).toEqual({ data: { userGuid: 'guid-2', imageGuid: null } });
  });

  it('both hooks no-op when no MP profile was captured', async () => {
    const hooks = userHooks();
    await runWithMpProfileCapture(async () => {
      expect(
        await hooks.create!.before!({ id: 'u1' } as never, null),
      ).toBeUndefined();
      expect(
        await hooks.update!.before!({ userGuid: 'spoofed' } as never, null),
      ).toBeUndefined();
    });
  });
});

describe('mapProfileToUser -> databaseHooks end to end', () => {
  beforeEach(() => {
    getTableRecords.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes the profile on every sign-in, not just sign-up', () => {
    // Without this, Better Auth never calls `updateUser` for a returning OAuth
    // user, so a row created before this fix keeps a NULL userGuid forever.
    expect(mpProviderConfig().overrideUserInfo).toBe(true);
  });

  it('lands the MP identity on the created row', async () => {
    getTableRecords.mockResolvedValue([{ Image_GUID: 'mp-image-guid' }]);
    const { mapProfileToUser } = mpProviderConfig();
    const hooks = userHooks();

    const { mapped, created } = await runWithMpProfileCapture(async () => {
      const mappedResult = await mapProfileToUser!({
        id: 'mp-user-guid',
        sub: 'mp-user-guid',
        email: 'a@example.com',
      });
      const createdResult = await hooks.create!.before!(
        { id: 'u1', email: 'a@example.com' } as never,
        null,
      );
      return { mapped: mappedResult, created: createdResult };
    });

    // Returning the fields from mapProfileToUser is useless (see above), so it
    // must not: the hook is the only writer.
    expect(mapped).toEqual({});
    expect(created).toEqual({
      data: { userGuid: 'mp-user-guid', imageGuid: 'mp-image-guid' },
    });
    expect(getTableRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'dp_Users',
        filter: "User_GUID = 'mp-user-guid'",
      }),
    );
  });

  it('still lands userGuid when the MP image lookup fails', async () => {
    getTableRecords.mockRejectedValue(new Error('MP down'));
    const { mapProfileToUser } = mpProviderConfig();
    const hooks = userHooks();

    const created = await runWithMpProfileCapture(async () => {
      await mapProfileToUser!({ id: 'mp-user-guid', email: 'a@example.com' });
      return hooks.create!.before!({ id: 'u1' } as never, null);
    });

    expect(created).toEqual({
      data: { userGuid: 'mp-user-guid', imageGuid: null },
    });
  });

  it('captures nothing when the provider profile has no subject', async () => {
    const { mapProfileToUser } = mpProviderConfig();
    const hooks = userHooks();

    const created = await runWithMpProfileCapture(async () => {
      await mapProfileToUser!({ email: 'a@example.com' });
      return hooks.create!.before!({ id: 'u1' } as never, null);
    });

    expect(created).toBeUndefined();
    expect(getTableRecords).not.toHaveBeenCalled();
  });
});
