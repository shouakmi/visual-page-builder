# Visual Page Builder — Technical Audit

**Auditor:** Principal Architect (incoming)
**Date:** 2026-07-16
**Subject:** Inherited work from conversation `e8d30144-193c-4837-93e1-2c0caa2556a3` (GPT-5.2 Codex, Phases 1–9 + extensions)
**Artifact under audit:** `Build_a complete visual page editor.md` (4,728 lines) — **the only artifact. No code exists on disk.**

---

## 0. Executive Summary

The transcript presents itself as nine completed phases plus five extension rounds. In reality it is a **narrated demo**: ~600 lines of snippets that illustrate ideas but do not compose into a running application. Every phase closes with a "✅ Summary" asserting completion; in multiple cases the assertion is contradicted by the code directly above it (see §4.1, §4.7).

**The single most important finding:** the project as specified **cannot be built on the data model in the transcript**. The style model is an opaque CSS *string* per node per breakpoint. A string cannot express hover states, transitions, keyframes, pseudo-elements, media queries, or design-token references — which is roughly 80% of the "Complete Style Editor" specification. This is not a bug to be fixed; it is a modeling error that invalidates the downstream renderer, exporter, and style panel. It must be corrected before any feature work.

**The second most important finding:** the highest-value entry point in the spec — *"open my existing HTML file"* — has **zero implementation and zero design**. There is no HTML→NodeTree importer anywhere in 4,728 lines. This is the architecturally hardest component in the entire product (arbitrary HTML/CSS is adversarial input), and it was never mentioned after Phase 1.

**Verdict:** Phase 1 (architecture) is genuinely good and should be preserved. Phases 2–9 are a prototype whose code cannot survive contact with the requirements.

---

## 1. Ground Truth: What Actually Exists

| Claimed | Reality |
|---|---|
| 9 phases complete | 0 phases exist as code on disk |
| "Monorepo" | 5 `package.json` files quoted in chat, none valid (§2.1) |
| "Production build" | Web app has no `index.html`; cannot boot (§2.4) |
| "Electron desktop" | Cannot start. Hardcoded to a dev server; TS entrypoint Electron can't execute (§4.9) |
| "Express backend / REST API" | 6 lines of comments (`// save to DB`). Does not exist |
| "SQLite (Desktop) / IndexedDB (Web)" | Neither. `localStorage` only |
| "Unlimited undo" | Unbounded full-state snapshots; one per keystroke (§4.3) |
| "Bidirectional Monaco sync" | Regex `/>(.*)</` against HTML (§4.2) |
| "Drag & Drop engine" | Does not move nodes in the tree. Sets `left/top` only (§4.1) |
| "Clean, production-ready export" | Exports **unstyled** HTML. WYSIWYG is violated (§4.7) |
| "Real-time collaboration (Yjs)" | Yjs used as a dumb blob store; CRDT defeated (§4.8) |
| "RBAC" | Client-side `disabled` attribute. Zero enforcement |
| Testing | 1 test, no config, no jsdom, no aliases. Will not run |

---

## 2. Blockers: The Code Does Not Assemble

These are not stylistic concerns. Each independently prevents `pnpm install && pnpm dev` from succeeding.

### 2.1 Every package name is invalid npm
```json
{ "name": "@ui" }          // packages/ui/package.json:749
{ "name": "@core-editor" } // packages/core-editor/package.json:805
{ "name": "@data" }        // and @renderer, @exporter
```
`@ui` is a **scope with no package name**. npm/pnpm reject this at install. The workspace never resolves. Correct form is `@vpb/ui`.

### 2.2 Module resolution is wired to nothing
`tsconfig.base.json:735` declares `"@ui/*": ["packages/ui/src/*"]` — a *wildcard* path. Every import in the codebase is **bare**: `import { AppShell } from "@ui"`. The wildcard does not match the bare specifier. Separately, `vite.config.ts:896` has **no `resolve.alias` at all**, so even a correct tsconfig path would fail at bundle time (tsconfig paths are type-level only; Vite does not read them without a plugin).

### 2.3 Packages have no build and no exports map
Each package sets `"main": "src/index.ts"`. Vite can transpile this; **Node and Electron cannot**. No `exports` field, no build step, no `dist`. The desktop main process could never import shared code.

### 2.4 The web app has no HTML entry
`main.tsx:917` calls `document.getElementById("root")!`. **No `apps/web/index.html` is ever provided** in 4,728 lines. Vite has no entry document. The app cannot boot.

### 2.5 Tailwind will silently delete the UI in production
`tailwind.config.ts:904` sets `content: ["./index.html", "./src/**/*.{ts,tsx}"]` — scoped to `apps/web` only. Every class in `packages/ui` (`AppShell`, `Panel`) is outside the content globs and **will be purged from the production bundle**. The app styles correctly in dev and renders unstyled in prod — the worst failure mode. No `postcss.config.js` is provided either.

### 2.6 Dark mode does not work; light mode does not exist
`ThemeProvider` (`:793`) renders `<div className="dark">`. Tailwind's `dark:` variant requires `darkMode: 'class'` in config (**not set**) and the class on `<html>`, not an arbitrary div. No `dark:` variants appear anywhere regardless. The spec's "Dark Mode & Light Mode" is a div with a class name on it.

---

## 3. The Two Fatal Modeling Errors

### 3.1 Style-as-string

```ts
props: Record<string, any> & { styles?: Partial<Record<Breakpoint, string>> }  // :2504
```

A node's style is `"padding:40px;"` — an opaque string. This model **cannot represent**:

- hover/focus/active states (spec: "Hover effects")
- transitions, animations, `@keyframes` (spec: dedicated sections)
- pseudo-elements
- media queries — **inline `style=` cannot contain them**, so responsive CSS is unexportable by construction
- design tokens / variables (spec: dedicated section) — no reference semantics in a string
- reusable classes / symbols (spec: dedicated section)

Every style write is also a **full-string replacement**, which is why the drag implementation destroys layout (§4.1). The style panel the spec demands (Typography, Layout, Flexbox, Grid, Background, Borders, Effects, Transforms, Transitions, Animations) requires parsing and re-serializing this string on every property read and write.

**Required:** a structured style model — `Map<StyleTarget, StyleDeclaration>` keyed by `(breakpoint, state, selector)`, with typed values and token references, compiled to a real stylesheet.

### 3.2 Breakpoints don't cascade

```ts
const bpStyle = props.styles?.[bp];   // :2540
```

Only the **exact** breakpoint's style applies. Set `padding` on desktop, switch to mobile → padding vanishes. Every real builder (Webflow, Framer, Elementor) inherits desktop → tablet → mobile unless overridden. This is backwards from both the CSS cascade and every competitor, and it means per-breakpoint styles can never compile to `@media` rules — they're inline attributes.

---

## 4. Defect Register

### 4.1 The drag engine does not drag
`Overlay.tsx:1506`:
```ts
const newStyle = `position:relative; left:${dx}px; top:${dy}px;`;
onUpdateStyle(state.selectedId, newStyle);
```
Three defects in two lines:
1. **Obliterates all existing styles** (padding, color, everything) — full string replacement.
2. `dx/dy` are measured from drag start, but `startRect` (`:1439`) is captured and **never used**. Position resets rather than accumulating.
3. It **never moves the node in the tree**. No reparenting, no reordering, no drop target. Phase 4 is titled "Drag & Drop Engine"; it implements neither drop nor structural drag.

Phase 4's summary claims "resize handles (top-left, bottom-right)". **One** handle is rendered (`:1526`), and it is wired to *move*, not resize.

Additionally: the iframe swallows `mousemove` the instant the cursor crosses into it. No pointer capture, no transparent shield. Drag stalls on first use.

### 4.2 Monaco sync is a regex and a feedback loop
`useEditor.ts:2324`:
```ts
const match = html.match(/>(.*)</);   // greedy; breaks on any nested markup
```
This is the "bidirectional synchronization" the brief calls out as needing to be "robust and production-ready." It is a greedy regex that fails on the first nested tag.

Worse, `CodeEditorPanel.tsx:1978` is a controlled Monaco whose `value` is **derived from the state its own `onChange` mutates**, with no debounce and no dirty-tracking. Every keystroke: type → setState → re-derive `htmlValue` → push back into Monaco → cursor jumps to position 0. The editor is unusable after the first character.

### 4.3 History is unusable and unbounded
- **Selection is committed to history** (`:3247`): `const select = (id) => commit({...state, selectedId: id})`. Undo undoes *clicks*. Breakpoint switches too (`:3249`). Undo is destroyed as a feature.
- **One snapshot per keystroke**: `updateCss` (`:3332`) calls `commit` on every character typed in Monaco.
- **Each entry is a full deep `EditorState`** (`:3178`) with no cap. "Unlimited undo" = unbounded memory growth, one full document clone per character. At thousands of nodes this exhausts the heap.

**Required:** patch-based history (immer patches / inverse commands), coalescing, transient-vs-committed state separation.

### 4.4 Every edit deep-clones the entire document
```ts
export function updateNode(root, id, props) {
  if (root.id === id) return { ...root, ...props };
  return { ...root, children: root.children.map(c => updateNode(c, id, props)) };  // :1096
}
```
This maps **every child in the entire tree**, not just the path to the target. Every keystroke rebuilds the whole document. `findNode` is an O(n) DFS on every single lookup, called before nearly every operation. There is no `id → node` index and no parent back-references — which is precisely why insert-before/after, reparenting, and drop indices are impossible: `insertNode` (`:1099`) can only **append to the end**.

The spec asks for "thousands of nodes." This model is O(n) per keystroke with a full structural clone.

### 4.5 The renderer is an XSS vector
```ts
.map(([k, v]) => `${k}="${String(v)}"`)   // :1141 — no escaping, anywhere
```
Props and text are interpolated raw into an HTML string. Any quote in user text breaks the markup; any `<script>` executes. The iframe is created via `doc.write` **from the parent** (`:1204`), making it **same-origin** — it has full access to the editor's `localStorage` and DOM. It carries no `sandbox` attribute.

Now combine this with the core requirement *"import an arbitrary HTML file / website folder / ZIP."* Untrusted third-party HTML would execute with the editor's own origin privileges. **This is the most serious security issue in the audit.**

### 4.6 The iframe is destroyed on every state change
`EditorCanvas.tsx:1604` — `doc.open(); doc.write(...); doc.close()` in a `useEffect` with deps `[state, onSelect]`. Since `select()` mutates state, **clicking an element re-writes the entire document**. This blows away scroll position, focus, form state, and re-executes all project JS (`<script>${project.js}</script>`, `:1801`) on every click and every keystroke. Under React 18 `StrictMode` (`:918`), effects double-invoke in dev — every script runs twice.

### 4.7 Export is not WYSIWYG — the cardinal sin
```ts
function renderNodeClean(node) {
  const attrs = Object.entries(props)
    .filter(([k]) => k !== "text" && k !== "style" && k !== "styles")  // :2953
```
The exporter **strips `styles` and never emits them anywhere**. Exported HTML has no per-node styling at all. It links `styles.css` containing only the global `project.css`.

`if (node.type === "text") return props.text` (`:2957`) also silently **drops all children**.

The ZIP (`:2999`) writes three files and no assets — so `blob:` URLs (`:2274`) land in the exported HTML, and every image is dead on arrival at the customer's server.

**What you see in the editor is not what you export.** For a page builder this is the one property that must never break, and it is broken at the root.

### 4.8 Yjs is used in a way that defeats Yjs
```ts
yProject.set("data", state.project);   // :4080 — the entire project as one blob
```
Yjs's entire value is granular CRDT merge. Storing the whole document as a single `Y.Map` value reduces it to **last-write-wins on the entire project**: two users editing different pages, and one silently annihilates the other's work. A hand-rolled `mergeProjects` (`:4110`) — also last-write-wins — is then bolted on alongside it. Two conflicting conflict-resolution strategies, neither functional.

Supporting defects: awareness is **polled on a 500ms `setInterval`** (`:4429`) instead of subscribing to its change event; the provider is created in `useMemo` and **never destroyed** (`:4423`) — a WebSocket leak on every unmount; cursor coords are raw `e.clientX/clientY` (`:4639`) with no canvas-space normalization, so cursors land in the wrong place at any zoom, scroll, or viewport width.

### 4.9 The desktop app cannot start
```ts
"main": "src/main.ts",   // :964 — Electron cannot execute TypeScript
"type": "module",        // :966 — hostile to the Electron main process
win.loadURL("http://localhost:5173");   // :992 — dev server hardcoded
```
No build step, no compiled output, no production `loadFile` path, no `webPreferences`, no preload, no IPC, no CSP. `new BrowserWindow({width, height})` and nothing else. The desktop application — half the product — **does not exist in any executable form**.

### 4.10 Persistence loses your work
`localStorage.setItem(KEY, JSON.stringify(state.project))` on every change (`:3241`) — synchronous main-thread JSON serialization of the whole document per keystroke, against a 5MB quota, with no error handling (quota exceeded throws and is uncaught).

Assets are **never persisted at all** — `assets` lives in a `useState` outside the saved project. And `URL.createObjectURL` (`:2274`) blob URLs are written into the project and **do not survive a page reload**. Every image in a reloaded project is permanently broken. The `createObjectURL` handles are never revoked — an unbounded memory leak.

### 4.11 Auto-snapshot never fires
```ts
useEffect(() => {
  const id = setInterval(() => createSnapshot(...), 300000);
  return () => clearInterval(id);
}, [state]);   // :3646
```
The dependency is `[state]`. Every edit tears down and recreates the 5-minute timer. **It can only fire after 5 minutes of total inactivity** — i.e. never while the user is working, which is exactly when it's needed. Silent, and the feature is listed as complete.

### 4.12 ID generation collides
`"node-" + Date.now()` (`:1255`), `"ver-" + Date.now()` (`:3500`), `"asset-" + Date.now()`, `"c-" + Date.now()`. Two operations in the same millisecond produce **duplicate IDs**. Non-deterministic, so tests can't assert on them, and collaboration will corrupt the tree. Needs UUIDv4 / nanoid.

### 4.13 Diff view is misleading
`DiffView` (`:3901`) diffs **exported HTML**. Since export drops all styles (§4.7), the diff **cannot show style changes** — the most common edit in a page builder. It renders a confident green/red diff that omits most of what changed. Diff should operate on the model, not a lossy projection of it.

### 4.14 Assorted
- `AssetType` declares `image|video|font|svg|pdf|other` (`:2160`) but detection is `file.type.startsWith("image") ? "image" : "other"` (`:2278`) — video, font, svg, pdf all collapse to `other`. Preview exists only for images.
- `useDrag` re-registers window listeners on every render (`:1502`); `dragging` is read through a stale closure.
- Overlay rect is computed only when `selectedId`/`project` change (`:1481`) — no `ResizeObserver`, no scroll listener, no `MutationObserver`. The selection box desyncs on iframe scroll, resize, or webfont load.
- `logAction` (`:4142`) returns an object and is wired to nothing. Pure placeholder.
- `const API = "https://your-server.com/api"` (`:3732`, `:3955`) — placeholder host, no auth, no error handling, no retry. `useEffect(() => pushVersions(...), [versions])` PUTs the entire version array on mount and on every change.
- `const role: Role = "viewer"` (`:4014`) hardcoded; `can()` gates a `disabled` attribute. Client-side authorization is decoration — trivially bypassed in devtools, and there is no server to enforce it.
- Comments (`:4305`) have no persistence, no threading, no resolve, and no re-anchoring when their node is deleted.
- `props: Record<string, any>` (`:1065`) — `any` in the central data structure of a project whose brief demands "strongly typed."
- No error boundaries, no logging, no telemetry, no a11y (unlabeled buttons, no focus management, no ARIA), no i18n despite "Multi-language support."

---

## 5. Missing Abstractions

The gap between "5 node types" and "30+ components" is not a content gap — it's an **architecture gap**.

1. **Component registry.** `NodeType = "section"|"div"|"text"|"image"|"button"` (`:1060`) is a hardcoded union, switched on by hand in the renderer *and* the exporter. Adding "Accordion" means editing the type union, the renderer, and the exporter. This violates open/closed and makes the **plugin system structurally impossible** — a third-party plugin cannot extend a compile-time union in someone else's package. This is the single most consequential missing abstraction.
2. **HTML importer.** Zero implementation, zero design. The product's primary entry point.
3. **Command pattern.** `commands.ts` contains pure tree helpers, not commands. No `Command` interface, no invoker, no inverse ops, no transaction/batching — which is why history must snapshot (§4.3).
4. **Style engine.** No parse/normalize/serialize/compile pipeline. No token resolver. No specificity model.
5. **Page model.** Phase 1 designed `Project → Pages[] → NodeTree`. Implementation is `Project → root` (`:831`). **Multi-page was silently dropped** and never mentioned again. No assets, settings, SEO, tokens, or breakpoint definitions on `Project` either.
6. **Storage abstraction.** No `StorageAdapter` interface, so SQLite/IndexedDB/REST cannot be swapped per platform — the stated reason for the monorepo.
7. **Selection model.** Single `selectedId: string | null` (`:1077`). Multi-select is in the spec; the model can't hold it.
8. **DI/service layer.** Everything is a React hook. `useEditor` is a 120-line god-hook owning tree ops, assets, history, and persistence. None of it is testable headlessly or reusable in the Electron main process.

---

## 6. Module Scores

| Module | Score | Rationale |
|---|:--:|---|
| **Phase 1 Architecture** | **8/10** | Genuinely good. Monorepo, custom-over-GrapesJS, iframe+overlay, node-tree-as-truth, offline-first. Preserve this. Loses points: Pages[] designed then abandoned; no importer design. |
| Monorepo / Build | 1/10 | Invalid package names, no aliases, no builds, no entry HTML. Nothing installs. |
| Core data model | 2/10 | Style-as-string is fatal (§3.1). `any` props. No pages, parents, or index. |
| Node tree / commands | 2/10 | Full-tree clone per edit. Append-only insert. No parents → no D&D. |
| Rendering engine | 2/10 | Unescaped concat (XSS). Full `doc.write` per click. Same-origin, unsandboxed. |
| State management | 2/10 | God-hook. Zustand chosen in Phase 1, **never used**. Selection in history. |
| History | 2/10 | Unbounded full snapshots, one per keystroke, undoes selections. |
| Style system | 1/10 | Cannot express hover/transition/animation/media/tokens. Breakpoints don't cascade. |
| Selection engine | 3/10 | Works for single click. No multi-select. Overlay desyncs (no observers). |
| Drag & Drop | 1/10 | Doesn't move nodes. Destroys styles. Stalls over iframe. One handle, mislabeled. |
| Responsive | 2/10 | No cascade. Inline styles → media queries unexportable. |
| Monaco / sync | 2/10 | Regex HTML parsing. Controlled-value feedback loop; cursor jumps. |
| Asset manager | 2/10 | Blob URLs don't survive reload. Not persisted. No optimize/crop/WebP/folders. |
| Export engine | 1/10 | **Exports unstyled HTML.** Drops children. No assets. WYSIWYG violated. |
| Data storage | 1/10 | No SQLite, no IndexedDB. localStorage per keystroke. Assets lost. |
| Desktop (Electron) | 1/10 | Cannot start. No build, no prod path, no IPC, no CSP. |
| Web backend | 0/10 | Does not exist. Six comment lines. |
| Collaboration | 1/10 | Yjs blob-store defeats CRDT. Polled awareness. Leaked sockets. |
| Security | 1/10 | XSS by construction; same-origin unsandboxed iframe; client-only RBAC. |
| Testing | 1/10 | One trivial test. No config, no jsdom, no aliases. Will not run. No CI. |
| Plugin system | 0/10 | Not started. Structurally blocked by the hardcoded type union. |
| SEO / Tokens / Symbols / Templates / i18n / PNG-JPG-SVG-PDF export / Packaging | 0/10 | Not started. |

**Weighted overall: 1.8 / 10** — a prototype, correctly scoped for a demo, incorrectly labeled as nine completed phases.

---

## 7. Classification

**Production-ready:** *None.*

**Prototype (idea sound, code not salvageable):** node tree, renderer, selection, overlay, breakpoint switching, asset list, ZIP export, history stack, Monaco panel.

**Placeholder (declared complete, does nothing):** audit log, RBAC, cloud sync, version sync, backend endpoints, image optimization, folder tree, resize handles, drag-and-drop, auto-snapshot, dark mode.

**Actively harmful if shipped:** unstyled export (silent data loss for the customer), blob-URL persistence (silent asset loss on reload), unsandboxed same-origin iframe over imported HTML (XSS), client-only RBAC (false security).

---

## 8. Roadmap

Sequenced by dependency, not by feature glamour. Foundations first because §3.1 and §5.1 invalidate everything built on top of them.

### Phase A — Foundation (blocks everything)
Workspace that installs and runs; `@vpb/*` naming, aliases, builds, entry HTML, Tailwind content globs across packages, real light/dark theming, Vitest + jsdom + CI.

### Phase B — Core model (the pivot)
Typed `Node`/`Page`/`Project`; **structured style model** keyed by `(breakpoint, state, selector)` with token refs; cascading breakpoints; parent refs + `id→node` index; UUID ids; **component registry** (unblocks both the library and plugins).

### Phase C — Commands, history, state
`Command` interface + invoker; immer-patch history with coalescing and transient/committed separation; Zustand store as decided in Phase 1; headless, testable, no React.

### Phase D — Rendering & style compiler
Escaped rendering; **sandboxed** iframe; incremental DOM reconciliation (no `doc.write` per click); style model → real stylesheet with `@media`/`:hover`/`@keyframes`. **Establishes the WYSIWYG invariant: the editor and the exporter share one compiler.** Golden-file tests enforce it.

### Phase E — Interaction
Overlay with `ResizeObserver`/`MutationObserver`; pointer capture + iframe shield; structural drag with drop indices and reparenting; real resize/rotate; multi-select; snap guides; keyboard shortcuts.

### Phase F — Persistence
`StorageAdapter` interface → IndexedDB (web) + SQLite (desktop); assets as durable binary, not blob URLs; debounced off-main-thread autosave; project manager, recent, restore, backups.

### Phase G — Importer
HTML/CSS parse → NodeTree → style model. Fuzz-tested against hostile input. *Sequenced here because it is the true validator of the Phase B model — if the model can't round-trip real-world HTML, we learn it here rather than after building 30 components on it.*

### Phase H — Style panel & component library
The full visual editor surface (Typography, Layout, Flex, Grid, Background, Borders, Effects, Transforms, Transitions, Animations) + 30 components via the registry.

### Phase I — Export
HTML/CSS/JS/ZIP/JSON through the shared compiler; assets; optimization; then PNG/JPG/SVG/PDF.

### Phase J — Desktop & web
Electron with preload/IPC/CSP, prod build, Windows installer; Express + REST.

### Phase K — Platform
Plugin API, SEO, tokens/symbols/templates, i18n, settings, workspace.

### Phase L — Collaboration *(deferred, deliberately)*
Yjs done properly (CRDT-native tree, not blob), presence, cursors, comments, **server-enforced** RBAC.

**On sequencing:** the transcript built collaboration, RBAC, and audit logs (Extensions 3–5) before the app could open a file or export a styled page. Collaboration on a broken model multiplies the breakage across users. It goes last.

---

## 9. Recommendation

Preserve **Phase 1's architecture**. Rebuild the implementation from Phase A, because there is no code on disk to preserve and the snippet-level design (style-as-string, hardcoded type union, snapshot history, string-concat renderer) cannot carry the specification.

This is not a decision to discard work — it is the recognition that the work product of the prior sessions was **architectural**, and that part is being kept.
