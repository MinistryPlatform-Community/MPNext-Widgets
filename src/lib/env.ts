/**
 * Environment variable access helpers.
 *
 * Required env vars should be read through `getEnv()` so that a missing
 * configuration fails fast with a clear, actionable message naming the
 * variable — rather than surfacing later as a cryptic runtime error from
 * a `process.env.X!` non-null assertion.
 *
 * Mirrors the style of `getMpHost()` in `src/lib/embed/config.ts`.
 */

/**
 * Returns the value of a required environment variable.
 *
 * @throws Error if the variable is unset or empty.
 */
export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured. Set it in your environment.`);
  }
  return value;
}

/**
 * Returns the value of an optional environment variable, or `undefined`
 * when it is unset or empty.
 */
export function getEnvOptional(name: string): string | undefined {
  return process.env[name] || undefined;
}
