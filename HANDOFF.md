# Handoff

Living document. Update it at the end of every session; it is the first thing the next session reads.

The [README](./README.md) explains *what the architecture is and why*. This file records *where the
work stopped and what to pick up*. When they disagree, the README is the contract and this file is
the news.

---

## Where we are

**Phase B is complete. Phase C is next and not started.**

| | |
| --- | --- |
| Last session | 2026-07-17 — rewrote the two test suites lost in the incident |
| Git | `main` @ `6da69ce` "Stable baseline after Phase B3 recovery", tracking `origin/main` on [GitHub](https://github.com/shouakmi/visual-page-builder) |
| Working tree | **Uncommitted.** This session's work is on disk, not committed — see [Uncommitted work](#uncommitted-work) |
| `pnpm verify` | Green — 576 tests across 21 files |
| `pnpm mutate` | Green — 38/38 mutations caught |

Done: **A** (foundation, tokens, theming), **B1** (style vocabulary), **B2** (cascade engine),
**B3** (document model). Not started: **C** onward.

Test counts by project: `core` 488, `tokens` 48, `ui` 34, `web` 6.

---

## Uncommitted work

This session restored the `@vpb/tokens` and `@vpb/ui` suites destroyed in the 2026-07-17 incident.
The README called this the top pending task; it is now done. Four files, all new except the README:

| File | What |
| ---- | ---- |
| `packages/tokens/src/__tests__/tokens.test.ts` | 48 tests. The TS↔CSS token contract, derived from `SEMANTIC_TOKENS` in both directions, plus `surfaceDistinction` |
| `packages/ui/src/theme/__tests__/theme.test.tsx` | 34 tests. Drives the real `ThemeToggle` with real clicks/keys; asserts accessible names and the target's class |
| `tools/mutations/a-theming.mjs` | 19 mutations proving the two suites above actually fail when the code breaks |
| `README.md` | Removed the "NOT CURRENTLY ENFORCED" and "tokens and ui have NO tests" warnings; corrected the version-control paragraph; updated status and counts |

Nothing under `packages/*/src` other than the two test files was touched — no product code changed.

### The one finding worth carrying forward

Both suites passed on their first run. That proves nothing: they were written against code that
already passed them. `pnpm mutate` then found one test **vacuous** — *"survives storage that throws
on write"* passed with the `try`/`catch` it exists to protect deleted.

The cause generalises beyond this test. **React does not propagate a throw from a click handler back
to the caller**; it reports it. So `await user.click(...)` resolves cleanly even when the handler
exploded, and the assertions held anyway because `setPreferenceState` runs *before* the write. Any
future test asserting "this handler does not crash" is vacuous by default unless it observes errors
escaping to `window` — `errorsDuring()` in `theme.test.tsx` is the helper for that.

---

## Next: Phase C — commands, history, store

Delivers the headless, testable edit layer between the Phase B model and the Phase D renderer:
commands, patch-based undo/redo, and a Zustand store.

Nothing is designed yet. Constraints already fixed by the existing code and the README, which Phase C
must not violate:

- **`@vpb/core` stays framework-free** — no React, no DOM, no bundler. The store may live in a new
  package (`@vpb/state`?) or in `core` only if it stays React-free; Zustand's vanilla entry point
  (`zustand/vanilla`) is the seam that makes that possible. Decide this first: it sets the package
  boundary everything else in C imports across.
- **The tree is flat and shallow-copied** — `NodeTree` is `id -> Node` plus a derived `parents`
  index. An edit is a `Map` copy plus one replaced node. Do not reintroduce nested clones; that is
  the prototype's per-keystroke full-tree clone, AUDIT §4.4.
- **`validateTree` asserts `parents` against `children` after every mutation in the suite.** Any new
  mutation path must keep that invariant and be tested the same way.
- **Patches, not snapshots.** A snapshot-per-keystroke history over "thousands of nodes" is the
  memory profile the audit rejects.
- Undo must restore *selection*, not just the tree — an undo that leaves the wrong node selected
  silently retargets the user's next edit.

Finish the phase the way B2/B3 and A were finished: add `tools/mutations/c-*.mjs` and get every
mutation caught before calling it done. A phase without a mutation set is unproven.

---

## Conventions that bite

- **`pnpm verify` before every push.** CI runs the same gate **plus `format:check`**, which `verify`
  does not include — run `pnpm format` too, or CI fails on formatting alone. (It did this session.)
- **Write file-rewriting tooling in Node, never PowerShell.** PS 5.1 decodes UTF-8 as Windows-1252 on
  a `Get-Content`/`Set-Content` round-trip: it mangles every em-dash and prepends a BOM. It did this
  to four `@vpb/core` files during B3. `pnpm encoding:check` gates it; `pnpm encoding:fix` reverses it.
- **On this Windows box, Node is not on the shell's `PATH`** until refreshed from the Machine scope:
  `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`.
- No `any` (lint-enforced). No placeholder implementations. Comments explain *why*.
- Tests live in `__tests__/` beside the code and are picked up by `src/**/*.test.{ts,tsx}`.
- Adding a package with Tailwind classes? Add it to `@source` in `apps/web/src/styles.css` or its
  classes are silently dropped from the production build only.

---

## Open items

- **Phase C is unstarted** — see above.
- **The archived pre-move `dist/`** (outside the repo) is no longer load-bearing now that both lost
  suites are rewritten and the recovered sources are committed. Safe to drop after the next release.
- **`AUDIT.md` is the rationale for the roadmap ordering.** Read it before arguing with the order —
  notably why the importer (G) precedes the component library (H).
