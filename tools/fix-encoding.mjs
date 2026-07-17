#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * DETECT AND REPAIR UTF-8 FILES MANGLED BY WINDOWS POWERSHELL.
 *
 * Windows PowerShell 5.1 — the only PS on this machine — decodes UTF-8 as
 * Windows-1252 when it reads a file with `Get-Content`, and re-encodes the
 * result with `Set-Content -Encoding utf8`, adding a BOM. So `—` (E2 80 94)
 * comes back as `â€"` and `§` as `Â§`. Any PowerShell script that round-trips a
 * source file corrupts every non-ASCII character in it.
 *
 * This is not hypothetical: it happened during Phase B3's mutation run and
 * damaged four files in `@vpb/core` at once. Source here is comment-heavy and
 * uses em-dashes throughout, so nearly every file is vulnerable, and the damage
 * is easy to miss in review — the code still compiles and the tests still pass.
 *
 *   pnpm encoding:check    # report only, non-zero exit if anything is damaged
 *   pnpm encoding:fix      # repair in place
 *
 * THE REAL FIX is to never let PowerShell write a source file: use Node
 * (`readFileSync(p,'utf8')`) in tooling. This is the recovery hatch, and the
 * check is what stops a corrupted file reaching a commit.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/**
 * The 0x80–0x9F block: the only part of Windows-1252 that is not Latin-1, so it
 * needs an explicit table to reverse. Everything below 0xFF maps to itself.
 */
const CP1252_HIGH = new Map(
  Object.entries({
    '€': 0x80,
    '‚': 0x82,
    ƒ: 0x83,
    '„': 0x84,
    '…': 0x85,
    '†': 0x86,
    '‡': 0x87,
    ˆ: 0x88,
    '‰': 0x89,
    Š: 0x8a,
    '‹': 0x8b,
    Œ: 0x8c,
    Ž: 0x8e,
    '‘': 0x91,
    '’': 0x92,
    '“': 0x93,
    '”': 0x94,
    '•': 0x95,
    '–': 0x96,
    '—': 0x97,
    '˜': 0x98,
    '™': 0x99,
    š: 0x9a,
    '›': 0x9b,
    œ: 0x9c,
    ž: 0x9e,
    Ÿ: 0x9f,
  }),
);

/**
 * Signatures of a UTF-8 sequence misread as CP1252. `Ã`/`Â`/`â` lead the common
 * cases (accented letters, §/£/°, and the em-dash/quote block respectively).
 * Matched as pairs rather than bare letters so a legitimate `Â` in prose is not
 * flagged.
 */
const MOJIBAKE = /[ÃÂâ][-¿–—€‚-„†-•…‰‹›]/;
const BOM = '﻿';

/** Reverse the CP1252 misread: chars -> the bytes they came from -> UTF-8. */
function repair(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (CP1252_HIGH.has(ch)) bytes.push(CP1252_HIGH.get(ch));
    else return null; // Not CP1252-reversible: real content, not mojibake.
  }
  const fixed = Buffer.from(bytes).toString('utf8');
  return fixed.includes('�') ? null : fixed;
}

const damaged = [];
const patterns = ['packages/**/*.{ts,tsx,css}', 'apps/**/*.{ts,tsx,css}', 'tools/**/*.mjs', '*.md'];

/**
 * This file is the one legitimate holder of mojibake: its table and its comments
 * quote the exact sequences it hunts for. Scanning itself is a guaranteed,
 * permanent false positive — and a check that always fails gets deleted.
 */
const SELF = relative(root, fileURLToPath(import.meta.url)).replaceAll('\\', '/');

for (const pattern of patterns) {
  for await (const entry of glob(pattern, {
    cwd: root,
    exclude: ['**/node_modules/**', '**/dist/**'],
  })) {
    if (entry.replaceAll('\\', '/') === SELF) continue;

    const path = join(root, entry);
    const raw = readFileSync(path, 'utf8');

    const hasBom = raw.startsWith(BOM);
    const body = hasBom ? raw.slice(1) : raw;
    const hasMojibake = MOJIBAKE.test(body);
    if (!hasBom && !hasMojibake) continue;

    const issues = [hasBom && 'BOM', hasMojibake && 'mojibake'].filter(Boolean).join(' + ');
    damaged.push({ file: relative(root, path), issues });

    if (check) continue;

    const fixed = hasMojibake ? repair(body) : body;
    if (fixed === null) {
      console.error(`${entry}: mojibake is not automatically reversible — repair by hand.`);
      continue;
    }
    writeFileSync(path, fixed, 'utf8');
    console.log(`repaired ${entry} (${issues})`);
  }
}

if (damaged.length === 0) {
  console.log('Encoding clean: no BOMs, no mojibake.');
  process.exit(0);
}

if (check) {
  console.error(`\n${damaged.length} file(s) have encoding damage — run \`pnpm encoding:fix\`:`);
  for (const d of damaged) console.error(`  - ${d.file} (${d.issues})`);
  console.error(
    '\nCause: a PowerShell script almost certainly rewrote these. Use Node for file-rewriting tools.',
  );
  process.exit(1);
}
