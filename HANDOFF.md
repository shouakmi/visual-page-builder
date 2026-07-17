# Handoff

Living document. Update it at the end of every session; it is the first thing the next session reads.

The [README](./README.md) explains *what the architecture is and why*. This file records *where the
work stopped and what to pick up*. When they disagree, the README is the contract and this file is
the news.

---

## Where we are

**Phase C is functionally complete on branch `phase-c`. Phase D is next and must not be started
without a decision to start it.**

| | |
| --- | --- |
| Last session | 2026-07-17 — Phase C: the edit layer, end to end |
| Git | branch **`phase-c`** @ `06df95d`, seven commits ahead of `main` @ `6da69ce`. **Not pushed, not merged.** |
| Working tree | Clean |
| `pnpm verify` | Green — 732 tests across 27 files |
| `pnpm mutate` | Green — 64/64 caught (A 19, B3 19, C 26) |

Done: **A** (foundation, tokens, theming), **B1** (style vocabulary), **B2** (cascade engine),
**B3** (document model), **C** (commands, history, store). **D** onward not started.

Test counts by project: `core` 488, `state` 156, `tokens` 48, `ui` 34, `web` 6.

**The editor is real and has no face.** Every edit, undo, and redo works and is driven only from
tests; there is no renderer and no canvas. That is Phase D, and it is deliberately not begun.

### Commits on `phase-c`

| Commit | What |
| ------ | ---- |
| `6e24caa` | Restores the `@vpb/tokens` and `@vpb/ui` suites lost in the incident (previous session's work), plus `HANDOFF.md` and README corrections |
| `aa7f3bd` | Scaffolds `@vpb/state`, the `EditorState`/`EditorContext` model |
| `6069e2b` | The `Command` contract, the invoker, structural node commands |
| `3bf1930` | Corrects the false immer claim in `tree.ts`/`stylesheet.ts` |
| `5f0733f` | Style, prop, rename and class commands with coalesce keys |
| `318b8a8` | Inverse-command history and the headless Zustand store |
| `017cae7` | The Phase C mutation set, and the 3 vacuous tests it found |
| `06df95d` | `planDuplicateNode`, closing `tree.ts`'s promise |

### What `@vpb/state` contains

```
editorState.ts     EditorState = { project, context }; selection/page/breakpoint helpers
command.ts         Command, CommandOutcome, EditorEnvironment, applyCommand (the invoker)
commands/
  nodeCommands.ts  insert, insertSubtree, remove, move, restoreNodePosition, planDuplicateNode
  styleCommands.ts setStyleProperty, unsetStyleProperty  (the coalescing ones)
  propCommands.ts  setNodeProp, unsetNodeProp, renameNode, setNodeClasses, add/removeClass
history.ts         HistoryEntry, record, undo, redo, coalescing, the cap
store.ts           createEditorStore — vanilla Zustand: execute/preview/commitPreview/undo/redo
```

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

## What is left in Phase C

The phase's spec (AUDIT §8) is met. What remains is deliberate scope, not omission:

1. **Page commands.** `addPage`/`removePage`/`renamePage`/`movePage` exist in core but have no
   commands, so page management is not undoable. Left out because `removePage` also GCs node scopes
   and **the context must move off a deleted page** — `activePage` throws by design if it does not.
   That interacts with `EditorContext` in a way worth designing rather than bolting on. Nothing else
   in C depends on it.
2. **Asset commands.** Same story; Phase F owns assets and will want them.
3. **`valuesEqual` in `@vpb/core`** — see Technical debt.
4. **Multi-node commands.** Every command targets one node. Phase E's multi-select will want
   "delete/move all selected" as ONE history entry, which needs either a composite command or a
   transaction. `EditorContext.selection` is already a list, so the model is ready; the batching is
   not designed. AUDIT §7.3 lists "no transaction/batching" among the defects, so this is the one
   clause of that sentence not yet answered.

---

## Technical debt, honestly

- **`StyleValue` has no structural equality, so a no-op style edit takes a history entry.**
  `declarationsEqual` compares values by REFERENCE (`b[property] !== value`), so a fresh `px(100)`
  never equals a stored `px(100)`. Setting a property to the value it already has therefore records
  an entry whose undo is invisible — and an invisible Ctrl+Z gets pressed twice, costing a real edit.
  Coalescing hides the realistic case (a jittering slider is one entry). **The fix is `valuesEqual`
  in `@vpb/core/style/values.ts`**, which is conspicuously missing next to `colorsEqual`,
  `targetsEqual`, `scopesEqual` and `propsEqual`. It was not added this session because that is B1
  territory and needs its own mutation coverage. The gap is pinned by a test in
  `styleCommands.test.ts` that asserts today's behaviour *and the reason for it* — change that test
  when the function lands. Consider also whether `declarationsEqual`'s reference comparison is
  intentional or a latent bug of its own.
- **`git core.autocrlf=true` on this machine.** Harmless so far — commits contain only real changes —
  but the mutation harness writes LF and every `git add` prints conversion warnings. Worth an
  `.gitattributes` if it ever bites.
- **`phase-c` is unpushed and unmerged.** Seven commits.

Phase D is explicitly **not** to be started.

---

## Next: Phase D — renderer + style compiler

**Do not start it without being asked.** What Phase C leaves it, and what it must respect:

- **The store is the seam.** `createEditorStore` returns a vanilla `StoreApi<EditorStore>`; bind it
  with `useStore` from `zustand`. Do not move the store into React — the package's node Vitest
  project is what keeps it honest, and Electron's main process gets `@vpb/core` only.
- **`present` is what you render**, not `committed`. The difference is the live drag.
- **Definitions carry no `render` function** — core is framework-free, so Phase D owns the
  `componentId -> React` map per host (README, "A component is data").
- **The WYSIWYG invariant is the point of D**: the editor and the exporter share one compiler, and
  the cascade model already agrees with the browser by construction (README, "Cascade precedence").
  Golden-file tests enforce it (AUDIT §8).
- Phase D's emitter needs no `@layer`, no `!important`, no specificity hacks. If it seems to, the
  model is being fought rather than used.

---

## Open items

- **`AUDIT.md` is the rationale for the roadmap ordering.** Read it before arguing with the order —
  notably why the importer (G) precedes the component library (H).
- **`AUDIT.md` §8's Phase C line is the real spec** and neither the README nor this file referenced
  it until this session: *"`Command` interface + invoker; immer-patch history with coalescing and
  transient/committed separation; Zustand store as decided in Phase 1; headless, testable, no
  React."* Everything but the immer clause is implemented; that clause is answered above.
- **The archived pre-move `dist/`** (outside the repo) is no longer load-bearing now that both lost
  suites are rewritten and the recovered sources are committed. Safe to drop after the next release.
