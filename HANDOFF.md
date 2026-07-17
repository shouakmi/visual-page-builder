# Handoff

Living document. Update it at the end of every session; it is the first thing the next session reads.

The [README](./README.md) explains *what the architecture is and why*. This file records *where the
work stopped and what to pick up*. When they disagree, the README is the contract and this file is
the news.

---

## Where we are

**Phase B is complete. Phase C is in progress on branch `phase-c`.**

| | |
| --- | --- |
| Last session | 2026-07-17 — Phase C: commands and the edit layer |
| Git | branch **`phase-c`** @ `6069e2b`, three commits ahead of `main` @ `6da69ce`. **Not pushed, not merged.** |
| Working tree | Clean |
| `pnpm verify` | Green — 638 tests across 23 files |
| `pnpm mutate` | Green — 38/38 caught (**no Phase C set yet — see Remaining**) |

Done: **A** (foundation, tokens, theming), **B1** (style vocabulary), **B2** (cascade engine),
**B3** (document model). **C** is partially built; **D** onward not started.

Test counts by project: `core` 488, `state` 62, `tokens` 48, `ui` 34, `web` 6.

### Commits on `phase-c`

| Commit | What |
| ------ | ---- |
| `6e24caa` | Restores the `@vpb/tokens` and `@vpb/ui` suites lost in the incident (the previous session's work), plus `HANDOFF.md` and README corrections |
| `aa7f3bd` | Scaffolds `@vpb/state` and the `EditorState`/`EditorContext` model |
| `6069e2b` | The `Command` contract, the invoker, and structural node commands |

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

## Phase C — decisions made, and why

Two foundational choices were made this session. Both are implemented; do not silently reverse them.

### 1. History is INVERSE COMMANDS, not immer patches

`tree.ts:25` and `stylesheet.ts:36` both claimed *"Phase C replaces even the Map copy with immer
patches for structural sharing."* **That claim is wrong and the comments are now corrected.** It
failed on three counts:

- immer does not eliminate the Map copy — `produce` with `enableMapSet` shallow-copies a Map on first
  write, the same O(n) as `new Map(tree.nodes)`. It cannot do otherwise and leave the base immutable.
- The structural sharing already exists: the Map's *values* are shared by reference. That is what the
  flat tree bought.
- immer only generates fine-grained patches by **mutating a draft**, and every core mutator is a pure
  function returning a new object. Wrapping them in `produce` yields one coarse
  `replace /pages/0/tree` carrying a whole new tree — a snapshot in a patch's clothing. Real patches
  would mean rewriting ~30 mutation-tested B3 functions.

AUDIT §4.3's actual finding permits either: *"patch-based history (immer patches **/ inverse
commands**)"*; only the §8 one-line summary compressed it to "immer-patch". §7.3 lists *"no inverse
ops"* among the defects. Inverses are also cheaper — undoing an insert stores one `NodeId` where a
patch stores the replaced Map — and Phase L is CRDT-native Yjs, which consumes its own types, so
patches buy nothing there either.

### 2. The edit layer is `@vpb/state`, a new package

Core is the *document* — what Electron's main process and the export worker load. The edit layer is
the *editor*: selection, undo stacks, a store. Those hosts need the former and have no use for the
latter, so Zustand stays out of the package that must run everywhere. `@vpb/state`'s Vitest project
runs in **node**, making "headless" a build gate rather than a promise.

### Rules the code now enforces — read before extending

- **Mint ids at construction, never inside `apply`.** A redone command that re-mints gives the node a
  different id than the one the user just had, orphaning every node-scoped style rule and the
  selection that referenced the first. Hence `insertNodeCommand` takes a **pre-minted** node, and
  `EditorEnvironment` deliberately has **no `IdFactory`**.
- **`@vpb/core` refuses by returning its input.** `insertNode` on a duplicate, `moveNode` into a
  descendant, `updateNode` on an unknown id all hand back the same object. `applyCommand` therefore
  rejects any command that reports success while `state.project` is reference-identical — otherwise
  history takes an entry whose undo does nothing, the user presses Ctrl+Z, sees nothing, and presses
  again, losing a real edit. Commands must still check preconditions and give a specific reason.
- **The move inverse is not another move with the old index.** `moveNode`'s index is a position as
  the user sees it *before* the move; an inverse knows only where the node must end up, and for
  same-parent reorders those differ. Undo goes through `restoreNodePositionCommand`, which resolves
  the pre-move index at *its* apply time. A wrong inverse is invisible for reparents — all 16
  from/to pairs are tested for this reason.
- **Deleting a node must detach its node-scoped style rules AND the inverse must reattach them.** A
  delete that discards styling "undoes" into an unstyled node: data loss wearing an undo's clothes.
- **Context is recorded by history, never committed to it.** AUDIT §4.3 found selection and
  breakpoint switches creating history entries, so undo undid *clicks*. Changing selection is never
  an entry; an entry *records* the selection an edit happened in and restores it on undo.
- **The tree stays flat and shallow-copied.** Do not reintroduce nested clones (AUDIT §4.4), and keep
  `validateTree` passing after every command — the suite asserts it after each one.

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

## Remaining in Phase C

Built: `EditorState`/`EditorContext`, the `Command` contract, the invoker, and structural node
commands (insert, remove, move, restore-position, insert-subtree) with inverses.

Still to do, in order:

1. **Style and prop commands** — `setStyleProperty`/`unsetStyleProperty`, `setNodeProp`, rename,
   add/remove class. These are the ones that need `coalesceKey`.
   *Known wrinkle:* core's `setProperty` takes an `IdFactory` to mint a `StyleRuleId` when the rule
   does not exist. Per the mint-at-construction rule the command must carry a **pre-minted rule id**
   rather than take a factory into `apply`. Note the principled distinction: a `StyleRuleId` is an
   internal surrogate addressed only via the `(scope, target)` index, where a `NodeId` is referenced
   from outside (selection, style scopes, props) — which is why node ids are the strict case.
2. **`DuplicateNode`** — core's `duplicateNode` mints ids *internally* at apply time and returns an
   `idMap` for the caller's style-rule copy (`tree.ts:456` says so explicitly). To stay redo-stable
   it must be **planned at construction**: compute the duplicated subtree + rule copies up front, and
   let `apply` merely insert them.
3. **History** — undo/redo stacks, coalescing by `coalesceKey`, a bounded cap, and context restore.
4. **The vanilla Zustand store** — transient vs committed separation (AUDIT §4.3 requires it: a
   slider drag must not write an entry per frame).
5. **`tools/mutations/c-*.mjs`** — and every mutation caught. **A phase without a mutation set is
   unproven**, and Phase A proved that suites written after the code pass vacuously. Must include: a
   naive move inverse (`moveNodeCommand(id, oldParent, oldIndex)`), a removed `applyCommand` identity
   backstop, and a delete that drops style rules without restoring them.

Phase D is explicitly **not** to be started.

---

## Open items

- **`AUDIT.md` is the rationale for the roadmap ordering.** Read it before arguing with the order —
  notably why the importer (G) precedes the component library (H).
- **`AUDIT.md` §8's Phase C line is the real spec** and neither the README nor this file referenced
  it until now: *"`Command` interface + invoker; immer-patch history with coalescing and
  transient/committed separation; Zustand store as decided in Phase 1; headless, testable, no
  React."* Everything but the immer clause stands (see above).
- **The archived pre-move `dist/`** (outside the repo) is no longer load-bearing now that both lost
  suites are rewritten and the recovered sources are committed. Safe to drop after the next release.
- **`phase-c` is unpushed.** Nothing is on `origin` past `6da69ce`.
