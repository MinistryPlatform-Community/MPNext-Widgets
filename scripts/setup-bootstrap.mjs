#!/usr/bin/env node

/**
 * MPNext Setup Bootstrap
 *
 * Zero-dependency entry point for `pnpm setup` / `pnpm setup:check`.
 *
 * The full setup CLI (scripts/setup.ts) depends on devDependencies (chalk,
 * @inquirer/prompts) that do not exist on a fresh clone. Running it directly
 * crashes with "Cannot find module 'chalk'". This bootstrap uses only Node
 * built-ins, so it always runs, ensures pnpm + dependencies are present, then
 * hands off to setup.ts once its devDependencies are available.
 *
 * Usage (via package.json scripts):
 *   pnpm setup            -> node scripts/setup-bootstrap.mjs
 *   pnpm setup:check      -> node scripts/setup-bootstrap.mjs --check
 *   pnpm setup -- --clean -> node scripts/setup-bootstrap.mjs --clean
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const NODE_MODULES_PATH = path.join(PROJECT_ROOT, 'node_modules');
const forwardedArgs = process.argv.slice(2);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

// 1. Node version gate (matches package.json "engines": ">=20.9").
const major = Number(process.version.replace(/^v/, '').split('.')[0]);
if (Number.isNaN(major) || major < 20) {
  console.error(
    `\nMPNext setup requires Node.js v20.9 or later (found ${process.version}).\nInstall a newer Node (e.g. via nvm) and re-run.\n`
  );
  process.exit(1);
}

// 2. Ensure pnpm is available. corepack ships with Node and installs the
//    version pinned in package.json "packageManager".
const pnpmCheck = spawnSync('pnpm', ['--version'], {
  shell: true,
  stdio: 'ignore',
});
if (pnpmCheck.status !== 0) {
  console.log('pnpm not found on PATH — enabling it via corepack...');
  if (run('corepack', ['enable']) !== 0) {
    console.error(
      '\nCould not enable pnpm via corepack. Install pnpm manually, e.g.:\n' +
        '  corepack enable        (recommended — uses the pinned version)\n' +
        '  npm install -g pnpm\n'
    );
    process.exit(1);
  }
}

// 3. Install dependencies if missing, so setup.ts can load its devDependencies.
if (!existsSync(NODE_MODULES_PATH)) {
  console.log('Installing dependencies (first run, this can take a minute)...');
  const code = run('pnpm', ['install']);
  if (code !== 0) {
    console.error('\npnpm install failed — see the output above.\n');
    process.exit(code);
  }
}

// 4. Hand off to the full setup CLI; it is now safe to import chalk/inquirer.
process.exit(run('pnpm', ['exec', 'tsx', 'scripts/setup.ts', ...forwardedArgs]));
