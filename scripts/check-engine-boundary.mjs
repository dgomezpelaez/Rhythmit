/**
 * Engine boundary check — the only automated guard on the src/engine
 * layering (there is no linter). Enforced rules:
 *
 *  1. Engine files outside src/engine/pixi/ must not import pixi.js.
 *  2. Engine files import only within src/engine/ (no ../game, ../mods,
 *     main.ts) and no bare specifiers except pixi.js in the pixi tier.
 *  3. Non-engine files import the engine only via its three barrels:
 *     .../engine, .../engine/pixi, .../engine/autochart.
 *  4. Only src/engine/autochart/spawn.ts may reference worker.ts — the
 *     worker entry is side-effectful and must never leak via a barrel.
 *
 * Runs as part of `npm run build`. Exit code 1 on any violation.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../src');
const ENGINE = path.join(SRC, 'engine');
const PIXI_TIER = path.join(ENGINE, 'pixi');
const SPAWN = path.join(ENGINE, 'autochart', 'spawn.ts');

/** All import/export/new URL specifiers in a TS source file. */
function specifiersOf(source) {
  const out = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new URL\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

const BARREL_RE = /(?:^|\/)engine(?:\/pixi|\/autochart)?$/;

const errors = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  const inEngine = file.startsWith(ENGINE + path.sep);
  const inPixiTier = file.startsWith(PIXI_TIER + path.sep);
  for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
    const isRelative = spec.startsWith('.');
    const resolved = isRelative ? path.resolve(path.dirname(file), spec) : null;

    if (inEngine) {
      if (!isRelative) {
        if (spec === 'pixi.js' && inPixiTier) continue;
        errors.push(
          `${rel}: imports '${spec}' — engine allows no bare imports` +
            (spec === 'pixi.js' ? ' outside src/engine/pixi/' : ''),
        );
      } else if (!resolved.startsWith(ENGINE + path.sep)) {
        errors.push(`${rel}: imports '${spec}' — reaches outside src/engine/`);
      } else if (/\/worker(\.ts)?$/.test(spec) && file !== SPAWN) {
        errors.push(
          `${rel}: references the worker entry — only autochart/spawn.ts may`,
        );
      }
    } else if (resolved?.startsWith(ENGINE)) {
      if (!BARREL_RE.test(spec)) {
        errors.push(
          `${rel}: deep-imports '${spec}' — use the engine barrels ` +
            `(engine, engine/pixi, engine/autochart)`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error('engine boundary violations:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('engine boundary OK');
