# Visual Page Builder

An enterprise-grade, open-source visual page builder. Desktop (Electron) and Web from one codebase.

> **Status: Phase B complete — the domain model.** The workspace installs, typechecks, lints, tests,
> builds, and themes, and `@vpb/core` carries the full style/cascade/document model (B1–B3). There is
> no editor yet — no store, no renderer, no canvas; Phase C is next. See the [Roadmap](#roadmap).
> Panels in the running app name the phase that fills them rather than pretending to work.

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
packages/
  core/                 @vpb/core   — the domain model. Framework-free, no DOM.
    identity/                         branded ids + injectable factory
    style/                            values, units, colour, property catalog, serialisation
    node/                             props, component registry, nodes, the node tree
    document/                         pages, project, asset library
  tokens/               @vpb/tokens — design tokens: palette, semantic scale, theme.css
  ui/                   @vpb/ui     — design system: theming, primitives, app shell
tools/                  repo scripts
  mutate.mjs                          mutation-testing harness (see Testing)
  mutations/                          mutation sets, one file per phase — data, not code
  fix-encoding.mjs                    detect/repair PowerShell UTF-8 damage
  clean.mjs                           remove build output
```

Packages arriving later, per the roadmap: `renderer`, `storage`, `export`, `importer`, `plugins`.

**`@vpb/core` imports nothing from React, the DOM, or a bundler**, and it never will. The domain
model has to run in three places the browser is not: Node tests, the Electron main process, and
(eventually) a server-side export worker. The prototype's model lived inside a React hook and could
run in none of them.

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
2. **Scope** — `class[0]` < `class[1]` < … < node-local
3. **Breakpoint** — `base` < `tablet` < `mobile-landscape` < `mobile`

_State over scope_, because a node-local `color: blue` must not silently strip the class's
`:hover`. _Scope over breakpoint_, because an explicit element-specific value should not evaporate
when you resize.

The payoff: **this is exactly what a browser produces from source-ordered CSS.** `:hover` adds a
class-level specificity (0,2,0 vs 0,1,0), so state wins on specificity alone; media queries add no
specificity, so within a state block source order decides. Phase D's emitter therefore needs no
`@layer`, no `!important`, and no specificity hacks — it emits in the same nesting the resolver
walks, and the browser reproduces the model for free. A model that agrees with the platform by
construction cannot drift from it. That is the WYSIWYG invariant, established in the model rather
than patched in the renderer.

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

One runner, four projects, each with the environment it needs (`vitest.config.ts`):

| Project  | Environment | Covers                                             | Status          |
| -------- | ----------- | -------------------------------------------------- | --------------- |
| `core`   | node        | The domain model: style, cascade, tree, document    | 488 tests       |
| `tokens` | node        | Token contract, CSS/TS parity, colour distinction   | 48 tests        |
| `ui`     | jsdom       | Theme resolution, persistence, DOM, a11y, keyboard  | 34 tests        |
| `web`    | node        | The `index.html` anti-FOUC bootstrap contract       | 6 tests         |

```bash
pnpm test                        # everything (576 today)
pnpm vitest run --project core   # one project
```

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

B2 and B3 were both built this way; B3's 19 mutations and Phase A's 19 are all caught — 38 in total.

Phase A's set is the argument for the whole practice. The rewritten `tokens`/`ui` suites passed on
their first run, which proves only that they were written against code that already passed them.
Mutation testing then found one that was **vacuous**: *"survives storage that throws on write"* still
passed with the `try`/`catch` it exists to protect deleted. React does not propagate a throw from a
click handler back to the caller — it *reports* it — so `await user.click(...)` resolved happily
while the handler exploded, and the test's assertions (the preference still applied) held either way
because `setPreferenceState` runs before the write. The test now asserts on errors escaping to
`window`, and catches it. **A test written after the code is a hypothesis until a mutation falsifies it.**

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
| C      | Commands, patch-based history, Zustand store — headless and testable            |
| D     | Renderer + style compiler; the shared-compiler WYSIWYG invariant            |
| E     | Interaction: overlay, structural drag, resize, multi-select, snap guides    |
| F     | Persistence: `StorageAdapter` → IndexedDB (web) + SQLite (desktop); assets  |
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
