# Handoff

Living document. Update it at the end of every session; it is the first thing the next session reads.

The [README](./README.md) explains *what the architecture is and why*. This file records *where the
work stopped and what to pick up*. When they disagree, the README is the contract and this file is
the news.

---

## Where we are

**Phases A–E COMPLETE. E1 (selection), E2 (drag), E3 (resize), E4 (multi-select ops + batching) and
E5 (snap guides) have all landed; Phase F (persistence) is next.**
Click to select, shift/ctrl to multi-select, a tracking overlay. Drag: `dropTarget` (where),
`dragMachine` (when), `dragController` + the `resolveDrop` DOM adapter, pointer capture, a live
`DropIndicator`. Resize: eight `ResizeHandles` grips → `resizeSize` (how big: edge direction, min
clamp, aspect lock) + `resizeMachine` (when) → `resizeController`, which previews width/height on the
active breakpoint via `setStylePropertiesCommand` (one undo entry for a corner's width AND height) and
commits on release. The browser-facing pieces cannot be observed on-screen in this environment (jsdom
has no layout; the Browser pane never paints — memory `browser-pane-tabs-never-paint`), so they are
pinned by **stubbed-layout tests** that feed known rects and by the `e2-app`/`e3-resize` mutation sets.
E4 adds `batchCommand` — several commands, ONE history entry, one combined inverse run backwards —
plus multi-delete, arrow-key sibling reorder, and the shortcut layer (Delete, Escape, Ctrl+Z/Y).
E5 adds snapping to the resize: `snapCandidates`/`snapSize` (which line, and the guide that explains
it), `snapTargets` (the DOM adapter), and `SnapGuides` (the overlay). **Phase E is closed; Phase F
(persistence) is next.** See the Phase E section.

| | |
| --- | --- |
| Last session | 2026-07-22 — E5 shipped: `snapGuides` + the machine's snap step (`@vpb/interaction`), `snapTargets` + `SnapGuides` + controller/Canvas wiring (`apps/web`), tests, and the `e5-snap`/`e5-app` mutation sets |
| Git | branch **`phase-c`**, ahead of `main` @ `6da69ce`; HEAD is the E5 commit `f50fe43`, on top of `b65c5cf` (E4). **Not pushed, not merged.** Rename to `phase-e` or merge — it now carries all of D and all of E. |
| Working tree | Clean (E5 + these doc updates committed) |
| `pnpm verify` | Green — typecheck, lint, encoding, **1000 tests across 46 files**, build (verified locally 2026-07-22) |
| `pnpm mutate` | Green — **186/186 caught**, zero survivors, zero stale, zero ambiguous, exit 0 (A 19, B2 9, B3 19, C 26, D1 12, D2 12, D3 9, D4 8, E1 7, E2 18, E3 14, E4 16, E5 17) |

Done: **A**, **B1**, **B2**, **B3**, **C**, all of **D** (D1–D4), and all of **E** (E1 selection, E2
structural drag, E3 resize, E4 multi-select ops + batching, E5 snap guides).

> Test counts by project: `core` 527, `state` 185, `interaction` 73, `renderer` 52, `tokens` 48,
> `ui` 34, `web` 81 = 1000.
>
> The branch is still named `phase-c` and now carries all of D and all of E. Rename or merge
> before it gets confusing.

**The canvas is interactive.** On top of the D4 wiring (`Canvas.tsx` reads `present`, compiles with
`compileStyleSheet`, renders through `RenderChildren` inside a `CanvasFrame`, sizes to the active
breakpoint), E1 adds selection: the renderer stamps a `data-vpb-node-id` hit-test handle on every
element, `Canvas` attaches a `pointerdown` listener to the frame document (via `onReady`) that walks
from the click to the nearest handle and calls `select`/`extendSelection`/`clearSelection`, and
`SelectionLayer` draws a box over each selected element — re-measured on `ResizeObserver`,
`MutationObserver`, frame scroll, and window resize (the observers AUDIT §4.14 was missing).

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
| `6854c1d` | Phase C recorded as complete in README + HANDOFF |
| `1bc94c7` | **Phase D:** class precedence moved from the element to the sheet, + the missing B2 mutation set |
| `9268800` | **Phase D:** the style compiler |

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
- **A mutation verdict is the EXIT CODE, never scraped text.** `mutate.mjs` used to decide "caught" by
  matching `/Tests\s+(\d+) failed/` in the runner's output and discarding the exit status
  (`const { out } = run(...)`). That is environment-dependent — colour codes, a reporter or vitest
  version whose summary reads differently — and when the pattern misses it scores **0**, which reads as
  SURVIVED. Because the baseline used the same function, the run also printed "green" first, so the
  signature is **an entire suite surviving while `pnpm verify` passes**. If you ever see that, suspect
  the harness, not the tests. The verdict is now `!outcome.ok`; the parsed count only decorates the row,
  and an unreadable count still reports `caught (non-zero exit)`. A `testCommand` that runs **zero
  tests** is also refused outright now, since it too exits 0 and would make everything "survive".
- **A mutation set's `testCommand` uses exactly ONE `--project`, and every `find` is a single line.**
  E3 first shipped as one file whose `testCommand` repeated the flag
  (`--project interaction --project state --project web`); that form is non-standard here (every E2 set
  scopes to one project) and parses differently across vitest builds — where it matches zero projects it
  runs zero tests, the baseline still reads "green", and **every mutation then "survives"**. Split E3
  into `e3-resize` (interaction), `e3-command` (state), `e3-app` (web), one `--project` each. Separately,
  the harness reads the working tree verbatim, so a `find` that spans lines with `\n` goes STALE on a
  CRLF checkout — keep every `find` single-line, and `.gitattributes` now pins LF so checkouts stop
  flipping. If a mutation run ever reports a whole set surviving, suspect the `testCommand` ran no tests
  before you suspect the tests.
- **Run `pnpm format` BEFORE writing a mutation set, and re-run the set after any format.** Prettier
  rewraps long lines, and a `find` pointing at a line it just split goes **STALE**. E5 hit this: the
  guide filter was one 103-character line when its mutation was written and two lines after
  `pnpm format`. The harness caught it (STALE fails the run, by design), but the cheap order is
  format first, then pin. Prefer targeting a SHORT line — a named intermediate like
  `const heldWidth = …` — over a long expression prettier is likely to reflow.
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
4. ~~**Multi-node commands.**~~ **ANSWERED by E4.** `batchCommand` makes several commands one history
   entry with one combined inverse, and `removeNodesCommand`/`reorderNodesCommand` are built on it, so
   AUDIT §7.3's "no transaction/batching" clause is now closed. See "What E4 shipped".

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
- **`phase-c` is unpushed and unmerged, and now carries all of D plus E1 and the E2 decision layer.**
  19 commits ahead of `main`.
- **B2's mutation set did not exist** until `1bc94c7`, despite the README claiming "B2 and B3 were
  both built this way". It was presumably lost with the two suites in the 2026-07-17 incident, and
  nothing noticed — **a missing mutation set fails silently by definition.** `b2-cascade.mjs` now
  covers the cascade code Phase D touched, but it was written against today's design, not B2's full
  surface. If you want the guarantee the README implies, the rest of B2 (breakpoint graph, targets,
  declarations, serialisation) still has no mutation coverage.

These items are still deferred as noted; none of them blocks Phase E.

---

## Phase E — where it stands

**COMPLETE. E1 (selection + overlay), E2 (structural drag), E3 (resize), E4 (multi-select ops +
batching) and E5 (snap guides) have all landed.** The full plan is in
`C:\Users\hp\.claude\plans\rustling-toasting-badger.md` (or ask for it) — it designs all of E and the
architecture that holds across it. The load-bearing decisions, so nobody reverses them:

- **DOM → NodeId is a dedicated `data-vpb-node-id` attribute, NOT the `n-<id>` styling class.** Stamped
  centrally in `renderNode` (`packages/renderer/src/RenderTree.tsx`) via `cloneElement`, so every
  renderer — including a plugin's — carries it. Reverse-parsing the CSS class would collide with a user
  class named literally `n-…`; the attribute keeps hit-testing off the styling encoding.
- **Selection hit-testing uses `element.closest(...)`, NOT `instanceof Element`.** The frame is
  `allow-same-origin`, so React creates the portaled nodes in the FRAME's realm; a parent-realm
  `instanceof Element` is `false` for every one of them and selection would silently never fire in a
  real browser. `closest` is a plain method on any Element, realm or not. (jsdom happens to be lax here,
  so only a real browser would have caught it — it is commented in `Canvas.tsx`.)
- **The overlay lives in the EDITOR document, `pointer-events-none`, positioned over the frame**
  (`apps/web/src/SelectionLayer.tsx`). It reads element rects out of the frame and re-measures on
  `ResizeObserver` + `MutationObserver` + frame `scroll` (capture) + window `resize` — the four the
  prototype lacked (AUDIT §4.14). Clicks land in the frame because the overlay does not capture them.
- **Selection reads `present.context.selection`.** But note: context edits go through the store's
  `withBoth`, so selection is mirrored to `present` AND `committed` — they never differ for a selection
  change. So a "reads committed instead of present" mutation on the overlay would SURVIVE and is
  deliberately **not** in the E1 set; that invariant is the canvas's (covered by D4). It will start to
  matter for the overlay only once a drag previews a selection change (E2).

Testing notes for the next session:

- **The `web` project renders into an iframe, so jsdom does no layout** — every `getBoundingClientRect`
  is zero. The E1 tests assert *which* node is selected and *which* nodes get a box, never pixels. Box
  geometry (positions, snap) is not unit-testable in jsdom and will need either a real browser or pure
  headless geometry (the plan puts that math in `@vpb/interaction` from E2).
- **jsdom has no `ResizeObserver`** — a no-op stub is in `apps/web/src/test/setup.ts`.

### What E1 shipped

- `packages/renderer/src/RenderTree.tsx` — the `data-vpb-node-id` handle (+ 4 renderer tests).
- `apps/web/src/Canvas.tsx` — captures the frame doc from `onReady`, the `pointerdown` selection hook.
- `apps/web/src/SelectionLayer.tsx` — the tracking overlay.
- `apps/web/src/__tests__/SelectionLayer.test.tsx` — 8 tests (click/shift/clear/replace + overlay).
- `tools/mutations/e1-selection.mjs` — 7 mutations, all caught.

### What E2 shipped (the decision layer — all tested)

The design splits the drag into a fully-tested brain and a thin, browser-pending DOM adapter, so
everything except the raw page measurement is verified.

- `packages/interaction/src/dropTarget.ts` — `dropTarget(pointer, zone) → {parentId, index}`. Pure
  arithmetic: counts the children whose midpoint is before the pointer along the stack axis. The zone's
  `children` INCLUDE the dragged node (same-parent), because `moveNode`'s index is measured before
  removal and it does the same-parent decrement itself — pass a list the node was cut from and every
  reorder is off by one. 12 tests; three feed the index through the real `moveNode` and assert order.
- `packages/interaction/src/dragMachine.ts` — `dragStep(state, input, {threshold}) → {state, intent}`,
  a pure state machine: `idle → pending → dragging`, threshold, and intents (`preview`/`clearPreview`/
  `commit`/`cancel`) the host performs. No store, no DOM. 11 tests.
- `apps/web/src/dragController.ts` — `createDragController(store, {onDraggingChange})` turns intents into
  store calls: `preview(moveNodeCommand(...))` on `present`, `commitPreview()` on release,
  `cancelPreview()` on Escape/invalid-hover. 6 tests against a REAL store, no DOM (the drop is injected).
- Mutations: `tools/mutations/e2-drag.mjs` (8 — geometry + machine) and `tools/mutations/e2-controller.mjs`
  (4 — the store integration). All caught.

### What E2's app slice shipped (the DOM adapter + pointer wiring)

The page-measuring adapter and pointer wiring, verified against a STUBBED layout because jsdom lays
nothing out (`getBoundingClientRect` is zero, `elementFromPoint` is `null`) and the Browser pane never
paints (memory `browser-pane-tabs-never-paint`). The tests hand these functions known rects and
hit-tests; the mutation set proves each decision is load-bearing.

- `apps/web/src/resolveDrop.ts` — `elementFromPoint` → nearest handle → `parentOf` → child rects →
  `canDropNode` guard → `dropTarget`. Reorders among siblings AND drops INTO a valid empty container
  (`into` = target accepts the dragged node). The axis is `horizontal` only when the box is really a
  flex ROW (`display:flex` + `flex-direction:row`) — a `flex-direction:row` read alone misfires on
  block stacks, the bug the integration test caught. Covered by `resolveDrop.test.ts`.
- `apps/web/src/Canvas.tsx` — the pointer wiring: a press arms `drag.down` and takes **pointer
  capture** (`root.setPointerCapture`) so the drag survives leaving the iframe (§4.1 fully solved, not
  the old `pointer-events-none` shield); `pointermove` feeds `resolveDrop` + `drag.move` and updates the
  indicator; `pointerup` → `drag.up` commits; Escape → `drag.cancel` reverts. Covered by
  `dragIntegration.test.tsx`.
- `apps/web/src/DropIndicator.tsx` — the live drop-indicator line drawn in the editor overlay at the
  resolved target boundary.
- `tools/mutations/e2-app.mjs` — 6 mutations, all caught (axis read, container drops, validity guard,
  pointer capture, indicator target, escape-cancels).

**On-screen confirmation is still owed when a paintable browser is available.** The logic is fully
pinned by stubbed-layout tests + mutations, but nothing has watched a real pointer drag reorder a node
on screen and commit exactly one undo entry in this environment. Do that opportunistically; it is a
confidence check on already-tested code, not a gap in coverage.

### What E3 shipped (resize — same split as drag)

Eight grips on the selected box, driving the same brain/adapter split. Everything but the one
`getBoundingClientRect` at grab time is verified without a browser.

- `packages/interaction/src/resizeGeometry.ts` — `resizeSize(start, handle, delta, constraints) → Size`.
  Pure arithmetic: signed per-handle factors turn "pointer moved right/down" into which edge grew, the
  aspect lock ties the two axes (width drives a corner, the driven axis drives a side), and the min
  clamp is last so a box drags small but never past the floor that keeps it selectable. **v1 is
  width/height only** — in flow layout the box's top-left is layout-determined, so there is no
  `left`/`top` to write; absolute-position resize is a later refinement, as into-container drops were
  for E2. 9 tests.
- `packages/interaction/src/resizeMachine.ts` — `resizeStep(state, input, {threshold, minWidth,
  minHeight}) → {state, intent}`, mirroring `dragMachine`: `idle → pending → resizing`, threshold, and
  `preview`/`commit`/`cancel` intents. Unlike drag it owns the size math (`resizeSize` needs no DOM), so
  the controller stays trivial. 11 tests.
- `packages/state/src/commands/styleCommands.ts` — `setStylePropertiesCommand(scope, target,
  declarations, ruleId)`: sets SEVERAL properties on one (scope, target) as ONE entry, so a corner's
  width AND height are one undo. Its inverse restores each to its prior value, `unset` included. This is
  the minimal answer to "one gesture, one entry"; E4's `batchCommand` (across nodes) is the general one.
  Coalesce key includes the sorted property set, so a width-only gesture does not merge into a
  width+height one. 7 tests.
- `apps/web/src/resizeController.ts` — `createResizeController(store, {ids, onResizingChange})`. Turns
  intents into `preview(setStylePropertiesCommand(...))` on the **active breakpoint** and `commitPreview`
  on release. Mints ONE rule id per gesture at `down` (reusing one across gestures on different nodes
  would stamp two rules with the same identity). 6 tests against a REAL store, no DOM.
- `apps/web/src/ResizeHandles.tsx` — the grips in the editor overlay (`pointer-events-auto`, so a grab
  does not fall through to the frame's selection/drag). Single selection only in v1. Measures the start
  size at grab time and takes pointer capture on the grip. Covered by `ResizeHandles.test.tsx`.
- `tools/mutations/e3-resize.mjs` (interaction, 7), `e3-command.mjs` (state, 2), `e3-app.mjs` (web, 5)
  — 14 mutations, all caught. One `--project` per file, single-line `find`s (see Conventions that bite).
  Geometry: min clamp, edge direction, axis, aspect; machine: threshold, commit, escape; command:
  coalesce key, unset-on-undo; controller: width+height, commit, cancel-vs-commit, active-vs-base
  breakpoint; grips: transposed start.

On-screen confirmation of a real resize is owed opportunistically, on the same terms as E2's drag.

### What E4 shipped (batching + multi-select ops)

The last clause of AUDIT §7.3 — "no transaction/batching" — answered without new history machinery,
because **a transaction in an inverse-command history IS a composite with a combined inverse**.

- `packages/state/src/commands/batch.ts` — `batchCommand(label, commands)`. Runs the parts in order
  through `applyCommand` (so each part keeps the invoker's "changed nothing" backstop), collects each
  inverse, and undoes by running them **REVERSED**. Removing siblings a@0 then b@0 (b shifted when a
  went) only undoes to `[a, b]` backwards; forward order restores the same nodes to the wrong slots —
  invisible for one command and wrong for exactly the multi-node case this exists for. **Atomic**: any
  part refusing aborts the whole batch with no state, so nothing partial can reach history. An **empty
  batch refuses** (it would be an entry whose undo does nothing). No `coalesceKey`.
- `nodeCommands.ts` — `topmostNodes(tree, ids)` drops any node whose ancestor is also selected; without
  it, selecting a container AND its child asks to remove the child twice and atomicity sinks the delete.
  `removeNodesCommand(ids)` deletes the selection as one entry (each part still carries its own inverse
  including the node-scoped style rules). `reorderNodesCommand(ids, ±1)` moves each selected node one
  slot among its siblings.
- **Arrow keys REORDER, they do not nudge by pixels.** Flow layout has no `left`/`top` to move, so pixel
  nudging would mean inventing a positioning model; it waits for absolute positioning. Reorder is a
  **RELATIVE** command and therefore carries **no `coalesceKey`** — `history.ts`'s `merge` takes the
  later entry's `redo` wholesale, which is only valid for commands that assign. It also **refuses at the
  boundary** rather than no-op, because `moveNode` clamps but still returns a NEW tree, so a node already
  first would otherwise report success having changed nothing.
- Multi-node ordering: moving earlier walks front-to-back, later back-to-front, so a node never lands on
  a slot another selected node is about to vacate. Target indices are computed against the pre-batch tree
  and converted by the existing `preMoveIndexFor`.
- `apps/web/src/keyboardController.ts` — the shortcut table as a tested seam taking a `KeyboardEvent`
  (Canvas only binds the listener). Delete/Backspace, arrows, Escape, Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y.
  Two guards worth keeping: it **never fires while focus is in a text field** (`closest`, not
  `instanceof`, for the realm reason E1 documented), and it **declines while `pending !== null`** so a
  previewing drag/resize owns Escape rather than having the selection cleared out from under its cancel.
- Mutations: `tools/mutations/e4-batch.mjs` (state, 9) and `e4-keys.mjs` (web, 7).

### What E5 shipped (snap guides — the resize gets a magnet)

The last slice of Phase E, and the one whose scope had to be sharpened before it could be built.

**Snapping applies to the RESIZE, not the drag, and that follows from the model.** A structural drag
resolves to a discrete `{parentId, index}` — a gap already drawn by `DropIndicator` — so there is no
continuous position to attract. A resize is continuous, so its edges can be pulled onto a neighbour's
line. Building drag-snapping would have meant building absolute positioning first, which is E5
quietly becoming a different phase. The same constraint narrows *which* edges: `resizeSize` writes
width/height only, so only the **right** and **bottom** edges (and the centres, which move at half the
rate) actually move. There is no near-edge snap because there is no `left`/`top` to write.

- `packages/interaction/src/snapGuides.ts` — `snapCandidates(rects)` turns neighbour rects into lines
  (both edges + the midline, both axes); `snapSize(origin, proposed, candidates, options)` returns the
  adjusted size and the guides that explain it. Distance is the **on-screen gap**, not the width
  change: a centre match closes a 3px gap by growing 6px, and thresholding the width change instead
  would make centre snapping fire at half the visual distance of edge snapping. Ties break
  deterministically (far edge over centre, then the lower line) so the result cannot depend on the
  order rects were collected in. 21 tests.
- `packages/interaction/src/resizeMachine.ts` — additive only: an optional `snap` on the `move` input
  (`{boxOrigin, candidates}`, measured **fresh each move** because resizing reflows the page), an
  optional `snapThreshold`, and `guides` on the `preview` intent. **Order is `resizeSize` → snap →
  clamp**: the min floor is what keeps a box selectable, so it overrules a snap below it — and the
  guide is dropped with it, because a guide claims the edge IS on the line. 6 tests.
- `apps/web/src/snapTargets.ts` — the DOM adapter, sibling of `resolveDrop`. Siblings + the container,
  never the node itself (its own edges are zero pixels away, so it could never be resized) and never
  its descendants (they move because it resized — a feedback loop). 8 tests.
- `apps/web/src/SnapGuides.tsx` — the overlay, third after `SelectionLayer` and `DropIndicator` and
  the same shape: editor document, `pointer-events-none`, measures its own origin. Draws only what
  `snapSize` reported. 5 tests.
- `apps/web/src/resizeController.ts` — additive: a `snapFor(nodeId)` provider (the host reads the DOM,
  the controller never does — that is what keeps it testable against a real store with no layout) and
  `onGuidesChange`, emptied when the gesture ends. 7 tests.
- `tools/mutations/e5-snap.mjs` (interaction, 10) and `e5-app.mjs` (web, 7) — 17, all caught.

**The aspect modifier still means exactly one thing: preserve the ratio.** The first draft of this
plan proposed using it to disable snapping; that was rejected in review, correctly — a modifier doing
two jobs makes the gesture unpredictable at the moment the user is being most deliberate. So snapping
runs on every move, and under the lock only the axis the handle DRIVES may snap while the other is
re-derived from the ratio. The ratio therefore holds by construction, and a line reachable only by
breaking it is simply not taken, with no guide drawn. Both halves of that rule are pinned by mutation
(`the aspect lock is ignored and both axes snap freely`, `the locked resize stops deriving the other
axis from the ratio`).

**One pre-existing test file changed**, and it is worth knowing why: the `preview` intent now always
carries a `guides` array, so three `toEqual` assertions in `resizeMachine.test.ts` gained `guides: []`.
That is a shape change with no behaviour change — a resize with no candidates produces byte-identical
sizes, which `resizes exactly as before when the host offers no lines` asserts directly. No E1–E4
mutation went stale; no E1–E4 source file was touched except the two additive seams named above.

On-screen confirmation of a real snap is owed opportunistically, on the same terms as E2's drag and
E3's resize — jsdom lays nothing out and the Browser pane never paints here, so the stubbed-layout
tests and the mutation sets are the real verification.

### Still to do in Phase E

Nothing — E1 through E5 are all complete. **Phase F (persistence: `StorageAdapter` → IndexedDB +
SQLite, assets) is next.**

Two pieces of browser-pending confirmation carry forward out of the phase, none of them coverage gaps:
a real pointer drag reordering a node on screen (E2), a real grip resize (E3), and a real snap with its
guide (E5). All three are logic that is fully pinned by stubbed-layout tests and mutations; what has
not happened is a human watching a laid-out page do it.

---

## Phase D — where it stands

**Complete — D1 through D4.** D1 (the style compiler), D2 (the renderer), D3 (the sandboxed canvas
frame), and D4 (the app wiring) have all landed. The subsections below record the compiler's design
first, then how D2–D4 came together.

**D1, the style compiler** (`packages/core/src/style/compile.ts`).

Before it could be written, Phase D found that the model **could not be exported**. `resolve.ts`
claimed its precedence was "EXACTLY what a browser produces from source-ordered CSS"; it was not, on
the scope axis. Precedence came from each node's `classes` list, and CSS has no such concept. Two
elements with the same classes in opposite orders would each demand a different winner, which one
global source order cannot satisfy — an unfixable WYSIWYG hole (AUDIT §4.7) inside the model. Fixed
in `1bc94c7`: precedence is now `StyleSheet.classOrder`, project-wide. See the README's cascade
section.

The compiler's key decisions, so nobody "simplifies" them back:

- **It lives in `@vpb/core/style`**, because every primitive was already there and built for it
  (`cssOrder`'s own comment is about emission order). In `@vpb/renderer` it would force the exporter
  to depend on a package containing React.
- **Node scopes compile to a CLASS (`.n-<id>`), never `#id`.** An id selector is (1,0,0) and would
  outrank every class at every breakpoint — `.btn:hover` would lose to a node's resting colour and no
  emission order could fix it. As a class it ties at (0,1,0), so source order decides and precedence
  stays in the emitter's hands.
- **Do NOT merge the repeated `@media` blocks.** It looks redundant and is load-bearing: hoisting
  mobile rules into one block moves `.btn`'s mobile rule after `.n-x`'s base rule and inverts
  scope-over-breakpoint. This warning is also in the file, for Phase I.
- **The invariant is tested without a browser.** `propertySources` returns contributing rules
  "weakest first — the winner is last"; the browser settles those same rules by source order wherever
  specificity ties. So the test asserts the resolver's sequence **is** the CSS's sequence. Plus the
  golden file AUDIT §8 asks for.

### How D2–D4 landed

1. **`@vpb/renderer` (D2)** — the `componentId -> React` map (`createBuiltinRenderers`) plus escaped
   rendering of the node tree (`RenderChildren`), answering AUDIT §4.5: the prototype interpolated
   props and text raw into an HTML string, so any quote broke the markup and any `<script>` executed.
   Elements carry `class="n-<id> <classes>"` via the compiler's exported `classNameFor` /
   `nodeClassName()` — the renderer's half of the compiler's contract.
2. **The sandboxed iframe canvas (D3)** — `CanvasFrame`, a frame that cannot run page code, answering
   §4.5 (the prototype's `doc.write` iframe was same-origin with full access to the editor's
   `localStorage` and carried no `sandbox` attribute) and §4.6 (it was rebuilt by `doc.open/write/close`
   on every state change, blowing away scroll, focus, and form state and re-running all project JS).
   It reconciles incrementally rather than rewriting the document.
3. **App wiring (D4)** — `apps/web/src/Canvas.tsx` binds the store with `useStore`, compiles the active
   page with `compileStyleSheet`, renders its tree through `RenderChildren` inside `CanvasFrame`, and
   sizes the frame to the active breakpoint so the real media queries fire against the same stylesheet
   the export ships. It opens on `apps/web/src/starterProject.ts`, a real `Project` (shared class,
   node-local override, `:hover`, mobile rule) rather than a mock.

Mutation coverage already exists for D2 and D3 (verified 2026-07-17, `pnpm mutate` green):

- **D2 — canvas renderer, 12 mutations** (`tools/mutations/`). Includes the escaping and URL invariants:
  *text rendered through `dangerouslySetInnerHTML`*, *`href`/*`image src` no longer checked with
  `isSafeUrl`*, *node class dropped from the element class list*, *children never walked*, *renderer map
  ignored in favour of the default*. All caught.
- **D3 — sandboxed canvas, 9 mutations.** Includes *`allow-scripts` added alongside `allow-same-origin`*,
  *`sandbox` attribute removed entirely*, *page rendered into the parent document instead of the frame*,
  *a new style element created on every css change* (incremental reconciliation). All caught.

- **D4 — app wiring, 8 mutations** (`tools/mutations/d4-wiring.mjs`, added 2026-07-17). Pins the
  wiring itself, which every other package's suite passes right through: *reads `committed` instead of
  `present`* (freezes live previews), *renders the first page instead of the active one*, *drops the
  per-page node filter*, *never hands the compiled CSS to the frame*, *drops the page root class from
  the frame body*, and three device-sizing breaks. Each is caught by exactly one test in
  `apps/web/src/__tests__/Canvas.test.tsx` — the "caught by one" is deliberate: it proves each test is
  load-bearing rather than incidentally red. To make this testable the `web` project moved to jsdom
  (the canvas renders into an iframe); the bootstrap test opted back to node with a docblock.

**Phase D is now fully closed** — every sub-phase has tests and a mutation set. Two smaller checks are
not blockers but worth a look when Phase E opens the renderer again:

- **Golden-file tests for rendered HTML** — the renderer project has 48 tests; confirm a golden file
  pairs with the compiler's, per AUDIT §8, or add one.
- **`@source` for `@vpb/renderer`** — verify it is covered in `apps/web/src/styles.css` if it ships any
  Tailwind classes (see the README's Tailwind note). The production build passed, which is suggestive
  but not conclusive if the renderer emits no Tailwind classes of its own.

What Phase D inherited, and had to respect:

- **The store is the seam.** `createEditorStore` returns a vanilla `StoreApi<EditorStore>`; bind it
  with `useStore` from `zustand`. Do not move the store into React — the package's node Vitest
  project is what keeps it honest, and Electron's main process gets `@vpb/core` only.
- **`present` is what you render**, not `committed`. The difference is the live drag.
- **Definitions carry no `render` function** — core is framework-free, so Phase D owns the
  `componentId -> React` map per host (README, "A component is data").
- **There is ONE compiler and it already exists.** `compileStyleSheet` is it. If the renderer grows a
  second way to turn the model into CSS, the WYSIWYG invariant is gone — two compilers agree only
  until someone edits one. Phase I's exporter calls the same function.
- The emitter needs no `@layer`, no `!important`, no specificity hacks. If it seems to, the model is
  being fought rather than used.

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
