#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MUTATION TESTING HARNESS.
 *
 * Passing tests prove nothing until you have seen them fail. This deliberately
 * breaks the source — one edit at a time, reintroducing bugs the prototype
 * actually shipped (see AUDIT.md) — and asserts the suite notices. A mutation
 * that SURVIVES is a hole in the tests, not a curiosity: it is a bug we are
 * provably unable to detect.
 *
 * Run it at the end of every phase. Mutation sets live in `tools/mutations/` as
 * data, one file per phase, so this harness never changes.
 *
 *   pnpm mutate                     # every set
 *   pnpm mutate --set b3            # sets whose filename contains "b3"
 *   pnpm mutate --filter cycle      # mutations whose name contains "cycle"
 *   pnpm mutate --list              # show what would run, change nothing
 *
 * WRITTEN IN NODE ON PURPOSE. Windows PowerShell 5.1 decodes UTF-8 as
 * Windows-1252 on a Get-Content/Set-Content round-trip, so a PowerShell version
 * of this script silently corrupts every em-dash in every file it restores. It
 * did exactly that once, to four files at once. `readFileSync(p, 'utf8')` is
 * exact. See tools/fix-encoding.mjs.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const listOnly = args.includes('--list');
const setFilter = flag('--set');
const nameFilter = flag('--filter');

/**
 * Files currently holding a mutation, with their true contents.
 *
 * The single most important thing this script does is put every file back. A
 * try/finally is not enough: Ctrl-C during a two-minute run would otherwise
 * leave a deliberately broken source file on disk, and the next `pnpm verify`
 * failure would look like a real bug in code nobody touched. Every exit path
 * restores.
 */
const dirty = new Map();

function restoreAll() {
  for (const [path, original] of dirty) {
    try {
      writeFileSync(path, original, 'utf8');
    } catch (error) {
      // Last-ditch: a file we broke is still broken. Say so loudly and name it,
      // because silence here means a corrupt working tree with no explanation.
      console.error(`\nFAILED TO RESTORE ${path} — restore it by hand.\n${error}`);
    }
  }
  dirty.clear();
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreAll();
    process.exit(130);
  });
}
process.on('uncaughtException', (error) => {
  restoreAll();
  console.error(error);
  process.exit(1);
});
process.on('exit', restoreAll);

/**
 * Run the suite. `ok` is the EXIT CODE — the verdict — and `out` is for humans.
 *
 * A non-zero exit is what "the suite noticed" actually means: the runner decides it,
 * not us, and it survives colour, locale, reporter and version changes.
 */
function run(command) {
  try {
    return { ok: true, out: execSync(command, { cwd: root, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** Vitest colourises its summary; strip escapes before reading numbers out of it. */
function plain(out) {
  // eslint-disable-next-line no-control-regex
  return out.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * How many tests the suite reported failing — DETAIL ONLY, never the verdict.
 *
 * This used to BE the verdict, and that was the bug: scraping human-readable output
 * is environment-dependent, and when the pattern missed, every mutation scored 0 and
 * was reported as SURVIVED while the baseline simultaneously looked green. A whole
 * suite "surviving" while `pnpm verify` passes is that failure, not a test hole.
 * Returns `null` when the count cannot be read, which is now survivable.
 */
function failureCount(out) {
  const text = plain(out);
  const match = text.match(/Tests\s+(\d+)\s+failed/);
  if (match) return Number(match[1]);
  // A mutation that does not compile is still caught — tsc/vitest refused it.
  if (/error TS\d+|SyntaxError|Transform failed/.test(text)) return Infinity;
  return null;
}

/**
 * How many tests actually ran, or `null` when it cannot be read.
 *
 * Guards the other silent false negative: a `testCommand` that matches NO tests
 * exits 0, so the baseline looks green and every mutation "survives" against a suite
 * that never ran. Zero is an error; unreadable is only a warning, because the exit
 * code — not this — is what decides a mutation.
 */
function testsRan(out) {
  const match = plain(out).match(/Tests\s+[^\n]*?\((\d+)\)/);
  if (match) return Number(match[1]);
  if (/No test files found/i.test(plain(out))) return 0;
  return null;
}

const setsDir = join(root, 'tools', 'mutations');
const files = (await readdir(setsDir))
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => !setFilter || f.includes(setFilter))
  .sort();

if (files.length === 0) {
  console.error(
    `No mutation sets in tools/mutations/${setFilter ? ` matching "${setFilter}"` : ''}.`,
  );
  process.exit(1);
}

const sets = [];
for (const file of files) {
  const set = (await import(new URL(`mutations/${file}`, import.meta.url))).default;
  const mutations = set.mutations.filter((m) => !nameFilter || m.name.includes(nameFilter));
  if (mutations.length > 0) sets.push({ ...set, file, mutations });
}

// Without this, a --filter matching nothing runs zero mutations and reports
// "all caught" — a green tick for having tested nothing at all.
if (sets.length === 0) {
  console.error(`No mutations match --filter "${nameFilter}".`);
  process.exit(1);
}

if (listOnly) {
  for (const set of sets) {
    console.log(`\n${set.name}  (${set.file}, ${set.mutations.length} mutations)`);
    for (const m of set.mutations) console.log(`  - ${m.name}\n      ${m.file}`);
  }
  process.exit(0);
}

const results = [];
let baselineFailed = false;

for (const set of sets) {
  console.log(`\n=== ${set.name} ===`);

  /**
   * A red baseline makes every result meaningless: each mutation would be
   * scored "caught" by a failure it did not cause. Check once per set, before
   * touching anything.
   */
  process.stdout.write('baseline ... ');
  const baseline = run(set.testCommand);
  if (!baseline.ok) {
    console.log('FAILING — fix the suite before mutating.');
    console.log(baseline.out.slice(-1500));
    baselineFailed = true;
    continue;
  }

  /*
   * A command that matches no tests exits 0 and would score every mutation
   * "survived" against a suite that never ran. Refuse to mutate on that.
   */
  const ran = testsRan(baseline.out);
  if (ran === 0) {
    console.log('RAN NO TESTS — this testCommand matches nothing; fix it before mutating.');
    console.log(baseline.out.slice(-1500));
    baselineFailed = true;
    continue;
  }
  console.log(
    ran === null ? 'green (count unreadable; verdicts use exit codes)' : `green (${ran})`,
  );

  for (const mutation of set.mutations) {
    const path = join(root, mutation.file);
    const original = readFileSync(path, 'utf8');

    const occurrences = original.split(mutation.find).length - 1;
    if (occurrences === 0) {
      // The code moved and the mutation no longer describes it. Not a pass:
      // this mutation is now testing nothing at all.
      results.push({ set: set.file, mutation: mutation.name, result: 'STALE — pattern not found' });
      continue;
    }
    if (occurrences > 1) {
      // `replace` would silently hit only the first. Ambiguous means unproven.
      results.push({
        set: set.file,
        mutation: mutation.name,
        result: `AMBIGUOUS — ${occurrences} matches`,
      });
      continue;
    }

    dirty.set(path, original);
    writeFileSync(path, original.replace(mutation.find, mutation.replace), 'utf8');

    const outcome = run(set.testCommand);

    writeFileSync(path, original, 'utf8');
    dirty.delete(path);

    // Restoring a file must be byte-exact. If it is not, stop immediately rather
    // than mutate further on top of a damaged tree.
    if (readFileSync(path, 'utf8') !== original) {
      restoreAll();
      console.error(`\nRestore of ${mutation.file} was not byte-exact. Stopping.`);
      process.exit(1);
    }

    /*
     * THE VERDICT IS THE EXIT CODE. The suite exits non-zero when it notices the
     * mutation — that is the runner's own answer, and it holds whatever the output
     * looks like. The parsed count only decorates the row; when it cannot be read
     * the mutation is still CAUGHT, because the process already said so.
     */
    const caught = !outcome.ok;
    const failures = failureCount(outcome.out);
    const label = !caught
      ? '*** SURVIVED ***'
      : failures === Infinity
        ? 'caught (did not compile)'
        : typeof failures === 'number'
          ? `caught (${failures} failed)`
          : 'caught (non-zero exit)';
    results.push({ set: set.file, mutation: mutation.name, result: label });
    process.stdout.write(caught ? '.' : 'S');
  }
  process.stdout.write('\n');
}

console.log('');
console.table(results.map(({ mutation, result }) => ({ mutation, result })));

const survivors = results.filter((r) => r.result.startsWith('***'));
const stale = results.filter(
  (r) => r.result.startsWith('STALE') || r.result.startsWith('AMBIGUOUS'),
);

if (survivors.length > 0) {
  console.log(`\n${survivors.length} mutation(s) SURVIVED — the suite cannot detect these bugs:`);
  for (const s of survivors) console.log(`  - ${s.mutation}`);
}
if (stale.length > 0) {
  console.log(`\n${stale.length} mutation(s) no longer apply — update tools/mutations/:`);
  for (const s of stale) console.log(`  - ${s.mutation} (${s.result})`);
}
if (survivors.length === 0 && stale.length === 0 && !baselineFailed) {
  console.log(`\nAll ${results.length} mutations caught.`);
}

process.exit(survivors.length > 0 || stale.length > 0 || baselineFailed ? 1 : 0);
