# Visual Page Builder

An enterprise-grade, open-source visual page builder. Desktop (Electron) and Web from one codebase.

> **Status: Phases A–E complete, plus web persistence through F2 — the canvas is fully interactive and documents save, autosave, and reopen.** The workspace
> installs, typechecks, lints, tests, builds, and themes; `@vpb/core` carries the style/cascade/document
> model (B1–B3) **and the style compiler** (D1), and `@vpb/state` carries commands, undo/redo, and a
> headless store (C). Phase D closed the loop end to end: `@vpb/renderer` turns the node tree into
> escaped React (D2), a sandboxed iframe frame renders it without letting page code touch the editor
> (D3), and `apps/web` wires the store → the compiler → the renderer → the frame into a live canvas
> that opens on a real starter project (D4). Phase E adds interaction, starting with **selection (E1)**:
> click an element to select it, shift/ctrl to multi-select, and a tracking overlay draws a box over
> the selection. **Structural drag (E2) is complete**: the decision layer — the geometry
> (`@vpb/interaction`'s `dropTarget`), the press→threshold→move→drop lifecycle (`dragMachine`), and the
> store integration (`dragController`, which previews the move on `present` and commits it on release) —
> plus the DOM adapter that measures the page (`resolveDrop`: `elementFromPoint` → nearest handle →
> child rects → validity guard → `dropTarget`), pointer capture so a drag survives leaving the iframe,
> and a live drop-indicator line (`DropIndicator`). **Resize (E3) is complete too**: eight grips on the
> selection drive the same shape — headless geometry (`resizeSize`: which edge grows, the min-size
> clamp, the aspect lock) and lifecycle (`resizeMachine`) in `@vpb/interaction`, a `resizeController`
> that previews width/height on the active breakpoint and commits on release, and a
> `setStylePropertiesCommand` so a corner resize (width AND height) is ONE undo entry. **Multi-select
> ops (E4) are complete**: `batchCommand` makes several commands one history entry with one combined
> inverse — the answer to AUDIT §7.3's "no transaction/batching" — so deleting a whole selection is a
> single undo, arrow keys reorder the selection among its siblings, and Delete/Escape/Ctrl+Z/Ctrl+Y are
> wired to the store. **Snap guides (E5) close the phase**: `snapCandidates`/`snapSize` decide which
> neighbouring line a resized edge should land on, `snapTargets` reads the page for them, and
> `SnapGuides` draws the line that explains the result — with the aspect lock kept as the one thing the
> modifier means, so snapping yields to the ratio rather than switching off with it. Every
> browser-facing piece across E2–E5 is verified with stubbed-layout tests (jsdom lays nothing out) and a
> mutation set. The canvas renders through **the same compiler the export will call**, so what you see
> is what Phase I ships. **Phase F1 starts persistence**: `@vpb/core` gains `serializeProject`/
> `deserializeProject` — Maps become the JSON-safe arrays every one of them already had a constructor
> for, reconstructed through two validation layers (shape, then the existing `validateTree`/
> `validateStyleSheet`/`validateBreakpointSet`/`validateProject`) so untrusted JSON can never crash the
> caller — plus the one genuinely new primitive, `buildNodeTree`, that rebuilds a tree's derived parent
> index from a flat node array. A new package, **`@vpb/storage`**, carries the `StorageAdapter` contract,
> a cross-adapter test suite every future adapter runs, and an in-memory adapter; it depends on
> `@vpb/core` and nothing else, so `@vpb/state` can orchestrate persistence without either package
> knowing a browser or a filesystem exists. The store gains `save`/`loadDocument`/`newDocument`/
> `isDirty`, and the dirty-state checkpoint is a reference to a `HistoryEntry` rather than a timestamp —
> sound because commands are already deterministic and undo/redo move entries by reference. **Phase F2
> completes web persistence**: a real `IndexedDbStorageAdapter` (in `@vpb/storage`, injecting its
> `IDBFactory` so it stays node-testable through `fake-indexeddb`), an autosave controller in `@vpb/state`
> (debounced through an injected timer seam, never overlapping a save, never firing while a gesture is
> `pending`, always trailing an edit made during a save), and a minimal New/Save/Open document toolbar in
> `apps/web` that surfaces every failure rather than presenting it as success. F3 (assets) is next. See
> the [Roadmap](#roadmap).

See [`HANDOFF.md`](./HANDOFF.md) for where work stopped and what to pick up next, and
[`AUDIT.md`](./AUDIT.md) for the technical audit of the prior prototype that this codebase replaces,
including the reasoning behind the roadmap ordering.

---

## Quick start

Requires **Node >= 24** and **pnpm >= 10**.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

| Command              | Does                                                       |
| -------------------- | ---------------------------------------------------------- |
| `pnpm dev`           | Vite dev server for the web app                            |
| `pnpm build`         | Production build to `apps/web/dist`                        |
| `pnpm preview`       | Serve the production build                                  |
| `pnpm test`          | Run all test projects once                                  |
| `pnpm test:watch`    | Watch mode                                                  |
| `pnpm test:coverage` | Coverage report                                             |
| `pnpm typecheck`     | `tsc --noEmit` across every package, in parallel            |
| `pnpm lint`          | ESLint                                                      |
| `pnpm format`        | Prettier, write                                             |
| `pnpm mutate`        | Mutation-test the suite (`--list`, `--set`, `--filter`)     |
| `pnpm encoding:check`| Fail if any source file has a BOM or mojibake               |
| `pnpm encoding:fix`  | Repair encoding damage in place                             |
| `pnpm verify`        | typecheck + lint + encoding + test + build. **Run before every push.** |
| `pnpm clean`         | Remove build output (leaves `node_modules` alone)           |

---

## Layout

```
apps/
  web/                  @vpb/web    — the application (also Electron's renderer, Phase J)
    src/Canvas.tsx                    D4/E1: store -> compiler -> renderer -> frame, + click-to-select
    src/SelectionLayer.tsx            E1: the selection overlay, tracked by observers
    src/snapTargets.ts                E5: reads the page for the lines a resize may align to
    src/SnapGuides.tsx                E5: the guide lines that explain a snap
    src/starterProject.ts             the real Project the editor opens with (not a mock)
    src/DocumentBar.tsx               F2: minimal New/Save/Open toolbar + dirty/error indicator
    src/persistence.ts                F2: browser IDBFactory -> adapter, and the autosave attach guard
packages/
  core/                 @vpb/core   — the domain model. Framework-free, no DOM.
    identity/                         branded ids + injectable factory
    style/                            values, units, colour, property catalog, serialisation
      compile.ts                      THE compiler: model -> CSS. Shared by canvas (D) and export (I)
    node/                             props, component registry, nodes, the node tree
    document/                         pages, project, asset library
  state/                @vpb/state  — the edit layer: commands, history, store. No React, no DOM.
    editorState.ts                    the document + where the user is in it
    autosave.ts                       F2: debounce/trailing policy over the store's save()
  interaction/          @vpb/interaction — drag, resize and snap geometry + lifecycle machines. Headless (E2–E5)
  renderer/             @vpb/renderer — the node tree as escaped React, in a sandboxed iframe (D2/D3)
  storage/              @vpb/storage — the StorageAdapter contract, its cross-adapter test suite, the
                                        in-memory adapter (F1), and the IndexedDB adapter (F2). Headless;
                                        injects its IDBFactory; depends on @vpb/core only
  tokens/               @vpb/tokens — design tokens: palette, semantic scale, theme.css
  ui/                   @vpb/ui     — design system: theming, primitives, app shell
tools/                  repo scripts
  mutate.mjs                          mutation-testing harness (see Testing)
  mutations/                          mutation sets, one file per phase — data, not code
  fix-encoding.mjs                    detect/repair PowerShell UTF-8 damage
  clean.mjs                           remove build output
```

Packages arriving later, per the roadmap: `export`, `importer`, `plugins`.

**`@vpb/core` imports nothing from React, the DOM, or a bundler**, and it never will. The domain
model has to run in three places the browser is not: Node tests, the Electron main process, and
(eventually) a server-side export worker. The prototype's model lived inside a React hook and could
run in none of them.

**`@vpb/state` is a separate package for that same reason.** Core is the document — the thing
Electron's main process and the export worker load. The edit layer is the *editor*: selection, undo
stacks, a store. Those three hosts need the former and have no use for the latter, so the store's
dependencies (Zustand) stay out of the package that must run everywhere. `@vpb/state` is headless
too — its Vitest project runs in **node**, so a `window` reference anywhere in it fails the build
rather than waiting for Phase J to discover it.

---

## Architecture decisions

### Module resolution: package `exports`, not path aliases

`import { Button } from '@vpb/ui'` works with **no** `resolve.alias` in Vite and **no** `paths` in
tsconfig. pnpm symlinks `node_modules/@vpb/ui -> packages/ui`; Vite and TypeScript
(`moduleResolution: "bundler"`) both read that package's `exports` map.

One mechanism instead of two tables that must agree forever. The prototype needed both, kept neither
in sync, and had neither working.

### Packages are consumed from source

Package `exports` point at `src/index.ts`. No build step, no watch-mode rebuild, no stale `dist`.
Vite transpiles workspace sources as part of the app graph; `tsc --noEmit` per package provides the
type gate.

**Limit, stated plainly:** source-only packages cannot be `require`d by plain Node. That is fine
today — nothing outside the bundler consumes them. When Electron's **main** process needs shared code
(Phase F/J, e.g. `@vpb/storage`), *that* package gets a real build and a dual `exports` map. We will
pay that cost where it buys something, not everywhere up front.

### Theming: a `.dark` class, not `prefers-color-scheme`

A page builder must render a **light page preview inside dark editor chrome**. The user's design has
a colour scheme independent of the tool's. A media query is global and cannot express that; a class
can be scoped to a subtree. `@custom-variant dark (&:where(.dark, .dark *))` keeps specificity at
zero so the variant never wins an unintended cascade fight.

The preference is `light | dark | system`, defaulting to `system`, persisted through an injectable
`ThemeStorage` seam — the smallest instance of the `StorageAdapter` pattern Phase F generalises to
IndexedDB and SQLite.

### Cascade precedence: state > scope > breakpoint

Three axes compete when resolving what an element looks like. Strongest first:

1. **State** — `default` < `hover`/`focus`/…
2. **Scope** — `classOrder[0]` < `classOrder[1]` < … < node-local
3. **Breakpoint** — `base` < `tablet` < `mobile-landscape` < `mobile`

_State over scope_, because a node-local `color: blue` must not silently strip the class's
`:hover`. _Scope over breakpoint_, because an explicit element-specific value should not evaporate
when you resize.

The payoff: **this is exactly what a browser produces from source-ordered CSS.** `:hover` adds a
class-level specificity (0,2,0 vs 0,1,0), so state wins on specificity alone; media queries add no
specificity, so within a state block source order decides. The emitter therefore needs no `@layer`,
no `!important`, and no specificity hacks — it emits in the same nesting the resolver walks, and the
browser reproduces the model for free. A model that agrees with the platform by construction cannot
drift from it. That is the WYSIWYG invariant, established in the model rather than patched in the
renderer.

**Class precedence is the sheet's, not the element's** — `StyleSheet.classOrder`, project-wide. This
paragraph used to be untrue on the scope axis, and Phase D found it: the resolver read precedence off
each node's `classes` list, so `[alpha, beta]` and `[beta, alpha]` resolved differently. CSS has no
such concept — `class="a b"` and `class="b a"` are the same element, and the stylesheet's order
decides. Per-element ranking can therefore describe documents no stylesheet can reproduce (two
elements, same classes, opposite orders, each demanding a different winner), which is not extra
expressiveness but an unfixable export hole — §4.7's cardinal sin arriving through the model. A
node's `classes` is now a set of references whose order is presentational; an element that must
disagree with the ranking uses node-local rules, exactly as a CSS author would.

### Breakpoints are a graph, not a sorted list

Cascade is an explicit `inheritsFrom` edge, not something inferred from widths. Inference breaks the
moment a `min-width: 1440px` tier is added, where "wider" and "inherits from" point in opposite
directions. Deleting a breakpoint leaves its rules inert-but-intact (reported by `orphanedRules`)
rather than destroying the user's work on a misclick.

### The node tree is flat: children are ids, not nested objects

`NodeTree` is `id -> Node` plus a derived `id -> parentId` index; a node's `children` are `NodeId[]`.

The prototype nested node objects, so `updateNode` mapped **every child in the entire tree** to
rebuild the path to one edited node — a full structural clone per keystroke, against a spec asking
for "thousands of nodes" — and `findNode` was an O(n) depth-first search called before nearly every
operation. Flattening makes an edit a shallow `Map` copy plus one replaced node, and makes the index
possible at all: an index into a nested tree is invalidated by every edit that replaces the objects
it points at.

The parent index is what makes drag-and-drop expressible. Without parent references the prototype's
`insertNode` could only **append**, which is why "Phase 4: Drag & Drop Engine" shipped with neither
drop nor structural drag. `parents` is derived state maintained incrementally, so `validateTree`
asserts it against the `children` arrays after every mutation in the suite.

Two subtleties are load-bearing and tested by mutation: `moveNode` **refuses to move a node into its
own descendant** (a cycle detaches the branch into a self-referencing ring — the layer panel recurses
forever and the page is gone), and its `index` is a position in the children array *as the user sees
it*, before the move, so a same-parent move to a later index is decremented to absorb the shift the
removal causes.

### A component is data, not a case in a switch

`NodeType = "section"|"div"|"text"|"image"|"button"` was a compile-time union, hand-switched in the
renderer *and* the exporter. Adding a component meant editing three files; a third-party plugin could
add none at all, because you cannot extend someone else's union from outside their build. The audit
calls this the single most consequential missing abstraction — it blocks both the component library
and the plugin system.

A `ComponentDefinition` instead *describes* a component (tag, props, what it may contain) and the
renderer and exporter consume that description generically. Builtin ids are namespaced (`vpb:box`)
and permanent: they are persisted in every project file, so a plugin's `acme:carousel` can never
collide with a builtin added later. Definitions carry no `render` function — core is framework-free,
so Phase D keeps the `componentId -> React` map per host.

Props are a small discriminated union rather than `Record<string, any>`, for the same reason the
style model is not a string: an image's `src` is an `AssetId`, not a lookalike string, so "which
nodes use this asset?" — asset deletion, find-usages, export bundling — is answerable at all.

### History is inverse commands, not snapshots or patches

AUDIT §4.3 found history unusable for four separate reasons, and each has a named answer in
`@vpb/state`:

| The prototype | Here |
| ------------- | ---- |
| Each entry a full deep `EditorState`, uncapped | An entry holds two **commands** and a context. Plus a 100 cap |
| `commit` on every character typed | `coalesceKey` merges a run of edits to one target inside 500ms |
| Selection committed to history, so undo undid **clicks** | Context is **recorded** by an entry, never *is* one |
| No transient state, so a drag in flight was history | The store's `preview`/`commitPreview` pair |

A command produces the next state *and* the command that puts it back, both inside `apply` — because
an inverse needs what exists only before the edit, and that is gone by the time Ctrl+Z is pressed.

**Why not immer patches**, which §8's one-line summary asks for: `produce` with `enableMapSet`
shallow-copies a Map on write exactly as `new Map(tree.nodes)` does, so it removes no copy; the
values were already shared by reference, so the structural sharing already existed; and immer emits
fine-grained patches only by *mutating a draft*, which every pure core mutator refuses to do —
wrapping them yields one coarse `replace /pages/0/tree` carrying a whole new tree, a snapshot in a
patch's clothing. §4.3 itself asks for "immer patches **/ inverse commands**". An inverse is smaller
anyway: undoing an insert stores one `NodeId`.

Two rules fall out of this and are enforced by tests:

- **Nothing mints an id inside `apply`.** Redo is the *original command re-run*, which only
  reproduces the same document if commands are deterministic. `insertNodeCommand` therefore takes a
  pre-minted node, and `planDuplicateNode` computes the whole copy up front.
- **Only absolute commands may coalesce.** A merged entry redoes by running the *last* command
  against the *pre-first* state, which lands correctly precisely because these commands assign
  rather than adjust.

### Snapping aligns a resize, because a drag has nothing to align

Snap guides conventionally serve free positioning, and this editor has none — which decides where
snapping can and cannot apply.

A structural **drag** resolves to a discrete `{parentId, index}`: a gap between siblings, already drawn
by `DropIndicator`. There is no continuous position to attract, so there is nothing to snap. A
**resize** is continuous — width and height are real numbers — so its edges can be pulled onto a
neighbour's line. E5 is therefore resize-snapping, and adding drag-snapping would mean first adding
absolute positioning, which is E5 quietly becoming a different phase.

The same constraint narrows *which* edges snap. `resizeSize` writes width and height only, because in
flow layout the box's top-left is layout-determined and the model has no `left`/`top` to write. So of
the four edges only the **right** and the **bottom** actually move — dragging the west grip grows the
width and the browser still places the left edge where the layout says. Snapping matches those two
lines and the centres between them (which move at half the rate, so closing a 3px centre gap costs 6px
of width), and never a near edge.

**The aspect modifier means one thing: preserve the ratio.** It is not also a "disable snapping" key.
Snapping runs on every move; under the lock only the axis the handle *drives* may snap, and the other
is re-derived from the ratio — so the ratio holds by construction and a line reachable only by breaking
it is simply not taken, with no guide drawn. A modifier that silently did two jobs would make the
gesture unpredictable in exactly the moment the user is being most deliberate.

Guides never appear on speculation: one is emitted only where an edge genuinely landed on a line, and
where the minimum-size floor overrules a snap the guide is dropped with it. A line on screen always
means the box is on it.

### Persistence is a dedicated package, and dirty-state is a checkpoint, not a timestamp

Phase F1 adds `@vpb/storage`, holding the `StorageAdapter` contract, its cross-adapter test suite, and
an in-memory adapter. The dependency direction is one-way and enforced by what each package is allowed
to import: `core <- storage <- state <- apps/web`. `@vpb/storage` depends on `@vpb/core` (for
`DocumentFile` and the branded ids) and nothing else — not `@vpb/state`, not a browser, not a
filesystem — so `@vpb/state` can orchestrate persistence (`save`/`loadDocument`/`newDocument`) through
the interface without either package needing to know a concrete adapter exists. A `StorageAdapter`
moves bytes; it has no schema knowledge (`loadDocument` returns `unknown`, forcing every caller through
`@vpb/core`'s `deserializeDocumentFile` before anything is trusted), no debounce/autosave policy, and no
dirty-tracking — those live in the store, the same split this codebase already uses for drag and resize
(a headless "brain" plus a thin host-specific adapter).

**Serialization turns Maps into the arrays they already had constructors for.** `NodeTree.nodes`,
`StyleSheet.rules`, and `AssetLibrary.assets` are all `Map`s, and `JSON.stringify` drops a `Map`'s
entries silently. `createStyleSheet` and `createAssetLibrary` already rebuild their structures from an
array; the one genuinely missing piece was `buildNodeTree`, which derives `NodeTree.parents` from a flat
`Node[]` the same way every mutator in `tree.ts` already maintains it incrementally. It is deliberately
*mechanical* — it does not validate — because `deserializeProject` runs the untrusted result through the
same `validateTree` every other tree-producing operation is checked against, plus `validateStyleSheet`,
`validateBreakpointSet`, and the already-existing `validateProject`. A hand-written shape check catches
the common corruption (a missing field, a wrong type) with a specific message; anything deeper that
would otherwise throw inside core's own constructors is caught by a try/catch around the whole
reconstruction — untrusted JSON must never crash the caller, and this codebase has no schema-validation
dependency to reach for instead of writing that boundary by hand.

**Dirty-state is a reference to a `HistoryEntry`, not a timestamp or a deep comparison.** The store
records a `saveState` checkpoint — `'never-saved'`, or `{ entry: HistoryEntry | null }` naming whichever
entry was at the top of `history.past` at the moment of the last successful save or load — and
`isDirty()` is one reference comparison against the *current* top of `history.past`. This is sound, not
merely convenient: `undo`/`redo` already move `HistoryEntry` objects between `past` and `future` without
recreating them, and `@vpb/state`'s commands are already required to be deterministic (nothing mints an
id inside `apply`, the same rule that makes redo safe) — so the same entry reference at the top of
`history.past` can only mean the same resulting document. A false "clean" is therefore structurally
impossible; the only imprecision is a rare, harmless false "dirty" (re-doing an edit identical to one
truncated by a prior undo), which costs a redundant save, never a lost one. `save()` reads `committed`,
never `present`, for the same reason it always has: a live drag/resize preview lives only in `present`,
so a save can never persist an in-flight gesture by construction. Loading or creating a document
replaces `history` outright with a fresh, empty one — a new baseline, not a command with an inverse,
because by the time an "undo" of a load would run, the previous document's bytes may already be gone.

### F2: an IndexedDB adapter that injects its factory, autosave, and a minimal document UI

**The IndexedDB adapter injects its `IDBFactory`; it never reads a global `indexedDB`.**
`createIndexedDbStorageAdapter({ factory })` takes the factory as a parameter — the browser host passes
`window.indexedDB`, the tests pass `fake-indexeddb`'s. That is what keeps `@vpb/storage` runnable in
**node**: the package's Vitest project has no `indexedDB` global, so any real reach for one fails there
rather than in a future host. `tsconfig.base.json` already carries the DOM lib types, so this is a
*runtime* gate, not a compile one. The adapter runs the SAME cross-adapter contract suite the memory
adapter runs (behaviour cannot diverge), does one transaction per call resolved on
`transaction.oncomplete` — no `await` of a non-IDB promise mid-transaction, which would silently
auto-close it — and maps every failure to a typed `StorageError` by DOMException NAME
(`QuotaExceededError` → `quota-exceeded`, `DataCloneError` → `corrupt`, else `io-error`), so it can never
throw past its boundary. A failed open clears the cached connection so a later call can retry rather than
being poisoned for the adapter's life.

**Autosave is a debounce/trailing policy over `save()`, and it is disposable.**
`createAutosaveController(store, options)` (in `@vpb/state`) subscribes to the store and debounces edits
into saves through an INJECTED timer seam (`setTimer`/`clearTimer`, defaulting to `setTimeout`), so the
window is driven in tests rather than waited on — the same seam discipline as the store's `now`. Three
guarantees, each pinned by mutation: it NEVER saves while `pending !== null` (a live drag/resize preview
owns the document; the commit or cancel re-arms it), it NEVER overlaps a save (notifications are ignored
while one runs — including the store's OWN `set` inside `save()` — so no second timer is armed, and the
post-save check re-covers anything that arrived meanwhile), and it always TRAILS an edit that landed
during a save (a successful save reflects `committed` only as `save()` read it, so a mid-save edit leaves
the document dirty and re-arms). A failed save is deliberately not retried in a tight loop; the next
change re-arms it, and the host can surface the error and offer a manual Save. The controller is attached
ONLY when a storage adapter exists (without one, every edit would fire a pointless `io-error` save), and
`apps/web` disposes it on Vite HMR (`import.meta.hot.dispose`) so a hot-replaced module cannot leave an
armed timer against a discarded store. In production there is no earlier owner: the page's lifetime is
the controller's, and unload needs no teardown.

**The document UI is minimal and never presents a failure as success.** `DocumentBar` (New / Save / Open
plus a dirty indicator) owns no editor state; it drives the store's existing `newDocument`/`save`/
`loadDocument` and holds the adapter reference only to LIST documents. Opening still routes through
`store.loadDocument`, so the untrusted bytes are validated and history is reset in exactly one place. A
failed `listDocuments` shows an error rather than an empty "no documents" list — the one case where
failure and success would otherwise look identical — and a failed `save`/`loadDocument` shows an error
rather than silently doing nothing. A synchronous in-flight ref refuses overlapping actions (React state
updates too late to guard a double-click). `window.indexedDB` is read at exactly one line in `apps/web`
and handed to `createBrowserStorage`, keeping every browser-specific concern in the app and out of
`@vpb/state` and `@vpb/storage`.

### Tokens are enforced, not documented

`semantic.ts` (TypeScript) and `theme.css` (CSS custom properties) are two representations of one
truth, and they are meant to be held together by `tokens.test.ts`, which fails the build if they drift
in either direction, in either colour mode.

`surfaceDistinction` additionally asserts that tokens which sit on top of each other resolve to
*different* colours. This is not hypothetical: `border` and `surfaceRaised` were both `neutral[800]`,
making every dark-mode panel border invisible against its own background. The code read perfectly.
Only a running browser reporting `panelBg === panelBorder` caught it.

The expectations are *derived* from `SEMANTIC_TOKENS` rather than written out, in both directions: a
token with no CSS property fails, and a `--vpb-color-*` property with no token fails too. A
hand-maintained list of expected property names would be a third representation free to drift from
the other two.

### Tailwind must be told about the UI package

`@source '../../../packages/ui/src'` in `apps/web/src/styles.css`.

Tailwind skips `node_modules` by design, and pnpm symlinks `@vpb/ui` into it — so every class in
every shared component would be invisible to the scanner and omitted from the stylesheet. The failure
is production-only and silent: dev looks fine, `vite build` ships unstyled panels. **Any future
package containing Tailwind classes must be added here.**

---

## Testing

One runner, one project per package, each with the environment it needs (`vitest.config.ts`):

| Project    | Environment | Covers                                                  | Status          |
| ---------- | ----------- | ------------------------------------------------------- | --------------- |
| `core`     | node        | The model: style, cascade, compiler, tree, document, serialization (F1) | 544 tests |
| `state`    | node        | Commands, inverses, history, batching, the store, save/load/isDirty (F1), autosave (F2) | 212 tests |
| `interaction` | node     | Drag, resize and snap geometry, and the state machines   | 73 tests        |
| `storage`  | node        | The `StorageAdapter` contract, the in-memory adapter (F1), the IndexedDB adapter (F2) | 21 tests |
| `renderer` | jsdom       | Escaped rendering, the sandboxed frame, the hit-test handle | 52 tests     |
| `tokens`   | node        | Token contract, CSS/TS parity, colour distinction       | 48 tests        |
| `ui`       | jsdom       | Theme resolution, persistence, DOM, a11y, keyboard      | 34 tests        |
| `web`      | jsdom       | Canvas wiring (D4), selection (E1), drag/resize/keyboard/snap controllers (E2–E5), persistence UI + wiring (F2) | 94 tests |

```bash
pnpm test                        # everything (1078 today)
pnpm vitest run --project core   # one project
```

> The `web` project runs in jsdom because the canvas test renders into an iframe.
> The `index.html` bootstrap test opts back to node with a `// @vitest-environment
> node` docblock — it reads the HTML off disk and wants no DOM.

**Testing philosophy.** Tests assert behaviour through public surfaces, never internals. The theme
suite drives a real `ThemeToggle` with real clicks and keystrokes and asserts on accessible names and
the class on the target element — not on context internals. Injectable seams (`ThemeStorage`,
`SystemThemeSource`) exist so this needs no mocking framework and no global stubs; a test that
reaches for `vi.mock` means a seam has failed.

Adapters are treated as untrusted: the suite proves the provider survives storage that throws on
read, throws on write, or returns garbage. A dropped theme preference must never cost a white screen.

### Mutation testing — `pnpm mutate`

**Passing tests prove nothing until you have seen them fail.** At the end of every phase, the harness
reintroduces real bugs one at a time — mostly bugs the prototype actually shipped, cited to their
`AUDIT.md` finding — and asserts the suite notices. A mutation that **survives** is not a curiosity;
it is a bug we are provably unable to detect.

Mutations are data, in `tools/mutations/`, one file per phase, so the harness never changes:

```bash
pnpm mutate                # every set; non-zero exit if any survive
pnpm mutate --list         # show what would run, change nothing
pnpm mutate --filter cycle # one mutation by name
```

Every phase is built this way; **224 mutations are all caught** — 19 for A, 9 for B2, 19 for B3, 26 for
C, 12 for D1, 12 for D2 (the renderer: escaping, `isSafeUrl`, the `componentId -> React` map), 9 for D3
(the sandboxed frame: the `sandbox` attribute, incremental reconciliation), 8 for D4 (the app wiring:
`present` vs `committed`, the active page, the per-page node filter, device sizing), 7 for E1 (the
hit-test handle, the click→node walk, multi-select, the overlay), 18 for E2 (drag geometry: axis,
before/after boundary, index; the machine: threshold, commit-on-release, cancel-on-escape; the
controller: preview, commit-vs-cancel; and the app adapter/wiring: the display-vs-`flex-direction` axis
read, container drops, the validity guard, pointer capture, the drop-indicator target, escape-cancels),
and 14 for E3 (resize geometry: the min clamp, the edge direction, the axis, the aspect lock; the
machine: threshold, commit-on-release, escape-cancel; the plural command: the coalesce key, unset-on-
undo; the controller: width+height, commit, cancel-vs-commit, active-vs-base breakpoint; the grips:
the transposed start size), 16 for E4 (batching: partial apply, a forward inverse, a skipped
refusal, an empty batch; the multi-node ops: the topmost filter, a coalescing relative command, the
boundary guard, direction, processing order; the keyboard: Delete, arrow direction, Ctrl+Z-as-redo,
typing hijacked, Escape, the in-flight-gesture guard), and 17 for E5 (snap geometry: the threshold, the
centre's double rate, nearest-wins, per-axis independence, the inversion guard, the guide's position,
and both halves of the aspect rule; the machine: the floor overruling a snap, and a guide outliving the
clamp that overrode it; the app: **snapping disconnected entirely**, guides outliving the gesture, a box
offered its own edges, descendants instead of siblings, the container's lines dropped, a fixed origin,
and a guide drawn perpendicular to the edge it marks), and 18 for F1 (serialize/deserialize: a dropped
`classOrder`, an unsupported schema version accepted, the final `validateProject` check dropped,
`buildNodeTree` losing the whole parent index, a broken page tree accepted, the try/catch safety net
rethrowing instead of returning a typed error, a migration failure ignored; the in-memory adapter and
its contract: overwrite, delete, the `not-found` error kind, asset-byte delete, a dropped document name;
and the store: **`save()` persisting `present` instead of `committed`**, the checkpoint failing to
re-anchor to the current history tail, `isDirty()`'s `never-saved` case and its comparison both
individually inverted, a load that skips validation, and `newDocument` ignoring the given name), and 20
for F2 (the IndexedDB adapter: `add` instead of `put` so overwrite fails, the not-found boundary for both
documents and asset bytes, a dropped document name, the `quota-exceeded`/`corrupt` error-name mapping,
and a failed open cached so no later call can retry; the autosave controller: the pending guard, the
dirty guard, the debounce reset, the trailing save, the in-flight flag, and dispose's timer cancel; the
persistence UI: **a failed list reading as an empty "no documents" list**, a swallowed save failure, a
swallowed load failure, New not creating, Open bypassing the store, and the `createBrowserStorage` /
`attachAutosave` wiring guards).

Phase A's set is the argument for the whole practice. The rewritten `tokens`/`ui` suites passed on
their first run, which proves only that they were written against code that already passed them.
Mutation testing then found one that was **vacuous**: *"survives storage that throws on write"* still
passed with the `try`/`catch` it exists to protect deleted. React does not propagate a throw from a
click handler back to the caller — it *reports* it — so `await user.click(...)` resolved happily
while the handler exploded, and the test's assertions (the preference still applied) held either way
because `setPreferenceState` runs before the write. The test now asserts on errors escaping to
`window`, and catches it. **A test written after the code is a hypothesis until a mutation falsifies it.**

Phase C's set repeated the lesson on its first run: 3 of 23 survived, and **each survivor was a test
that looked like it tested something**. One asserted an undo restored the selection — but it undid a
*delete*, whose inverse selects the node it restores anyway, so the assertion held with the restore
deleted. One asserted a drag applied each preview to the committed state — but the previewed command
*assigns*, so stacking it on the previous preview reached the same value. One targeted a parameter
nothing ever passed. All three passed against correct code and would have kept passing against broken
code.

The harness checks the baseline
is green before it starts (a red baseline would score every mutation "caught" by a failure it did not
cause), restores files on **every** exit path including Ctrl-C, and verifies each restore is
byte-exact. A pattern that no longer matches is reported `STALE` and fails the run rather than
passing silently — when the code moves, re-point the mutation instead of losing the guarantee.

### Recovered packages — `@vpb/tokens` and `@vpb/ui` (2026-07-17)

On 2026-07-17 the repo was relocated into `claude-work/` by tooling outside the editor session, and
**`packages/tokens` and `packages/ui` lost every file**. There was no git history and no backup.

They were rebuilt from the one artifact that survived: the previous `vite build` sourcemap, whose
`sourcesContent` holds the exact pre-transform text of every bundled module.

| Files | Provenance |
| ----- | ---------- |
| `tokens`: `palette.ts`, `semantic.ts` — `ui`: `theme.ts`, `storage.ts`, `systemTheme.ts`, `ThemeProvider.tsx`, `ThemeToggle.tsx`, `useTheme.ts`, `cn.ts`, `Button.tsx`, `Panel.tsx`, `AppShell.tsx` | **Byte-exact original**, from the sourcemap |
| both `package.json` + `tsconfig.json`, both `src/index.ts` barrels, `ui/src/test/setup.ts` | **Reconstructed** — never bundled, so never in the map |
| `tokens/src/theme.css` | **Reconstructed, then verified**: the rebuilt CSS reproduces all 36 original `--vpb-color-*` declarations (18 tokens × 2 modes) identically against the archived bundle |
| `tokens.test.ts`, `theme.test.ts` | **Lost, and since rewritten** (2026-07-17). Not bundled, so the originals are unrecoverable; the replacements are new work, written against the recovered sources and validated by `pnpm mutate --set a-theming` |

The recovered stack was checked live: React mounts, `theme.css` resolves, the toggle flips dark↔light
with correct values both ways, and the preference persists. The reconstructed files are marked above
because they are *inference from the architecture*, not the original bytes — if one behaves oddly,
suspect it before suspecting the recovered originals.

The pre-move `dist/` is archived outside the repo and was the only copy of that source. Both lost
suites have now been rewritten and the recovered sources are committed, so the archive is no longer
load-bearing — keep it until the first post-recovery release if you want a second opinion on a
recovered file, but nothing depends on it.

**The repo now has version control** (`git init`, 2026-07-17): the recovery is committed as
`6da69ce`, with `origin` on GitHub. All of the above was survivable only because a sourcemap happened
to exist, which is not a backup strategy. Commit before, not after, the next incident.

### Encoding is checked in `verify`

`pnpm encoding:check` fails the build on a BOM or mojibake in any source file, and is part of
`pnpm verify`.

This guards a real, recurring hazard on Windows: PowerShell 5.1 decodes UTF-8 as Windows-1252 on a
`Get-Content`/`Set-Content` round-trip, so any PowerShell script that rewrites a source file expands
each em-dash (bytes `E2 80 94`) into a three-character CP1252 misreading, and prepends a BOM. It did
exactly that to four `@vpb/core` files during Phase B3's mutation run. The damage is easy to miss —
the code still compiles and the tests still pass — which is precisely why it is a gate.
`pnpm encoding:fix` reverses it.

> Note: prose must **describe** these byte sequences rather than quote them. `tools/fix-encoding.mjs`
> exempts only itself, so a raw mojibake sample pasted into any other file fails `pnpm verify` — as
> this very paragraph did on its first draft.

**The real rule: write file-rewriting tooling in Node, never PowerShell.**

---

## Roadmap

| Phase  | Delivers                                                                       |
| ------ | ------------------------------------------------------------------------------ |
| **A**  | **Foundation — workspace, tokens, theming, tests, CI. ✅ Done.**                |
| **B1** | **Style vocabulary — identity, typed values, property catalog, CSS output. ✅** |
| **B2** | **Cascade engine — breakpoints, targets, rules, stylesheet, resolver. ✅**      |
| **B3** | **Document — node tree + index, component registry, page/project. ✅**          |
| **C**  | **Commands, inverse-command history, Zustand store — headless and testable. ✅** |
| **D**  | **Renderer + style compiler + sandboxed canvas, wired into the app; the shared-compiler WYSIWYG invariant. ✅ Done.** |
| **E** | **Interaction: overlay, structural drag, resize, multi-select ops + batching, snap guides. ✅ Done (E1–E5).** |
| **F** | **Persistence: `StorageAdapter` → IndexedDB (web) + SQLite (desktop); assets. F1 (contract + serialize + store, headless) ✅. F2 (real IndexedDB adapter + autosave + New/Save/Open UI) ✅. F3 (assets), F4 (desktop interface) next.** |
| G     | HTML/CSS importer — the validator of the Phase B model                      |
| H     | Style panel + component library                                             |
| I     | Export: HTML/CSS/JS/ZIP/JSON via the shared compiler, then PNG/JPG/SVG/PDF  |
| J     | Electron (preload, IPC, CSP, installer) + Express/REST                      |
| K     | Plugins, SEO, tokens/symbols/templates, i18n, settings                      |
| L     | Collaboration: CRDT-native Yjs, presence, comments, server-enforced RBAC    |

**On ordering.** The importer (G) precedes the component library (H) because it is the true validator
of the Phase B model — if the model cannot round-trip real-world HTML, we want to learn that before
thirty components are built on it. Collaboration is last because collaboration on a broken model
multiplies breakage across users.

---

## Contributing

`pnpm verify` must pass before any push. CI runs the same gate plus `format:check` on Node 24, and
asserts the built artifact is real rather than trusting Vite's exit code.

Conventions:

- **No `any`.** Lint-enforced. Use `unknown` and narrow.
- **No placeholder implementations.** A feature is done or it is absent and labelled.
- **Comments explain _why_.** The code already says what.
- Strict TypeScript, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
