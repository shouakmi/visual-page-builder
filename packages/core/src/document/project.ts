import type { IdFactory } from '../identity/idFactory.ts';
import type { AssetId, ClassName, NodeId, PageId, ProjectId } from '../identity/ids.ts';
import type { BreakpointSet } from '../style/breakpoints.ts';
import { defaultBreakpoints } from '../style/breakpoints.ts';
import { nodeScope, parseScopeKey, type StyleScope } from '../style/rule.ts';
import type { StyleSheet } from '../style/stylesheet.ts';
import {
  allRules,
  EMPTY_STYLESHEET,
  putRule,
  removeScope,
  rulesForScope,
  scopeKeys,
} from '../style/stylesheet.ts';
import { referencedAssets as referencedStyleAssets } from '../style/values.ts';
import { nodesWithClass, treeAssets } from '../node/tree.ts';
import type { Asset, AssetLibrary } from './asset.ts';
import { allAssets, EMPTY_ASSET_LIBRARY } from './asset.ts';
import type { Page } from './page.ts';
import { createPage, normalizePath, validatePage } from './page.ts';

/**
 * THE DOCUMENT ROOT — everything a `.vpb` file contains.
 *
 * The prototype's `Project` was `{ root }` (AUDIT §7.5): no pages, no assets, no
 * settings, no tokens, no breakpoint definitions. Every one of those was in the
 * spec; every one of them was dropped silently.
 *
 * WHY THE STYLESHEET IS HERE AND NOT ON THE PAGE. Classes are reusable ACROSS
 * pages — that is the entire point of a class, and Webflow's model: `.btn` styled
 * on the home page must be the same `.btn` on the pricing page, or the user
 * restyles every button per page and the exported CSS duplicates every rule per
 * page. Node-scoped rules live in the same sheet because node ids are globally
 * unique, so the two scopes cannot collide.
 *
 * Breakpoints are likewise project-wide: a per-page breakpoint set would mean the
 * canvas's device switcher changed meaning as you navigated, and the exported CSS
 * would carry contradictory media queries.
 */
export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  /**
   * ORDERED — this is the pages panel's order and the user reorders it by hand.
   * A `Map` would key by id and lose the ordering the user chose; an array keeps
   * it and page counts are in the dozens, so the O(n) lookup `getPage` does is
   * measured in nanoseconds. (Contrast the stylesheet, which is indexed because
   * rules number in the thousands and sit on the style panel's hot path.)
   */
  readonly pages: readonly Page[];
  readonly styles: StyleSheet;
  readonly breakpoints: BreakpointSet;
  readonly assets: AssetLibrary;
  readonly settings: ProjectSettings;
}

export interface ProjectSettings {
  /** Prefixed to every page title on export: `About — Acme`. */
  readonly siteName?: string;
  /** Absolute base URL, for canonical tags and sitemaps. */
  readonly baseUrl?: string;
  readonly favicon?: AssetId;
  /** Injected verbatim into every page's `<head>` — analytics, verification tags. */
  readonly headHtml?: string;
  readonly language?: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = { language: 'en' };

/**
 * A new project with one home page.
 *
 * Never zero pages: a project with no pages has nothing to show in the canvas, and
 * every consumer would need an "empty project" branch. `removePage` enforces the
 * same floor from the other direction.
 */
export function createProject(name: string, ids: IdFactory): Project {
  return {
    id: ids.project(),
    name,
    pages: [createPage('Home', '/', ids)],
    styles: EMPTY_STYLESHEET,
    breakpoints: defaultBreakpoints(),
    assets: EMPTY_ASSET_LIBRARY,
    settings: DEFAULT_SETTINGS,
  };
}

/* ---------------------------------------------------------------- pages */

export function getPage(project: Project, id: PageId): Page | undefined {
  return project.pages.find((page) => page.id === id);
}

export function pageAtPath(project: Project, path: string): Page | undefined {
  const normalized = normalizePath(path);
  return project.pages.find((page) => page.path === normalized);
}

export function homePage(project: Project): Page | undefined {
  return pageAtPath(project, '/') ?? project.pages[0];
}

/** Is a path taken? `exclude` skips the page being renamed. */
export function pathInUse(project: Project, path: string, exclude?: PageId): boolean {
  const normalized = normalizePath(path);
  return project.pages.some((page) => page.path === normalized && page.id !== exclude);
}

/**
 * Add a page. Refused if its path collides.
 *
 * Two pages at one route is unresolvable at export: they write to the same
 * `index.html`, so one silently overwrites the other and the user loses a page
 * they can still see in the panel. Rejecting here — where the pages panel can say
 * "that path is taken" — is the only place this can be handled well.
 */
export function addPage(project: Project, page: Page): Project {
  if (pathInUse(project, page.path)) return project;
  if (getPage(project, page.id)) return project;
  return { ...project, pages: [...project.pages, page] };
}

export function updatePage(project: Project, page: Page): Project {
  const index = project.pages.findIndex((p) => p.id === page.id);
  if (index === -1) return project;
  if (pathInUse(project, page.path, page.id)) return project;

  const pages = [...project.pages];
  pages[index] = page;
  return { ...project, pages };
}

export function updatePageBy(project: Project, id: PageId, update: (page: Page) => Page): Project {
  const page = getPage(project, id);
  return page ? updatePage(project, update(page)) : project;
}

/**
 * Remove a page and every style rule scoped to the nodes it contained.
 *
 * The GC is the point. Node-scoped rules are keyed by node id and live in the
 * PROJECT's sheet, so deleting a page without sweeping them leaves rules for nodes
 * that no longer exist — they are invisible, unreachable, saved forever, and
 * emitted into the exported CSS on every build. This is exactly the leak
 * `removeNode` returns its removed ids to prevent, applied at page scale.
 *
 * The last page cannot be removed; see `createProject`.
 */
export function removePage(project: Project, id: PageId): Project {
  if (project.pages.length <= 1) return project;

  const page = getPage(project, id);
  if (!page) return project;

  let styles = project.styles;
  for (const nodeId of page.tree.nodes.keys()) {
    styles = removeScope(styles, nodeScope(nodeId));
  }

  return { ...project, pages: project.pages.filter((p) => p.id !== id), styles };
}

/** Reorder the pages panel. Index is clamped, as in `insertNode`. */
export function movePage(project: Project, id: PageId, index: number): Project {
  const from = project.pages.findIndex((page) => page.id === id);
  if (from === -1) return project;

  const pages = [...project.pages];
  const [page] = pages.splice(from, 1);
  if (!page) return project;

  pages.splice(Math.max(0, Math.min(Math.trunc(index), pages.length)), 0, page);
  return { ...project, pages };
}

/**
 * Copy a page, including its node-scoped style rules.
 *
 * The rule copy is why this lives on the project rather than beside
 * `duplicateNode`: the tree layer cannot see the stylesheet. Without it a
 * duplicated page would render unstyled wherever the original used a per-element
 * override — WYSIWYG broken at the moment the user least expects it.
 */
export function duplicatePage(
  project: Project,
  id: PageId,
  ids: IdFactory,
): { readonly project: Project; readonly newId: PageId | undefined } {
  const page = getPage(project, id);
  if (!page) return { project, newId: undefined };

  const idMap = new Map<NodeId, NodeId>();
  for (const nodeId of page.tree.nodes.keys()) idMap.set(nodeId, ids.node());

  const nodes = new Map(
    [...page.tree.nodes.values()].map((node) => {
      const newNodeId = idMap.get(node.id) as NodeId;
      return [
        newNodeId,
        { ...node, id: newNodeId, children: node.children.map((c) => idMap.get(c) as NodeId) },
      ] as const;
    }),
  );
  const parents = new Map(
    [...page.tree.parents.entries()].map(
      ([child, parent]) => [idMap.get(child) as NodeId, idMap.get(parent) as NodeId] as const,
    ),
  );

  const copy: Page = {
    ...page,
    id: ids.page(),
    name: `${page.name} copy`,
    path: uniquePath(project, page.path),
    tree: { root: idMap.get(page.tree.root) as NodeId, nodes, parents },
  };

  // One pass over the sheet's scopes, not one per node: a page with 2,000 nodes
  // and a sheet with 2,000 scopes would otherwise be four million parses.
  let styles = project.styles;
  for (const key of scopeKeys(project.styles)) {
    const scope = parseScopeKey(key);
    if (scope?.kind !== 'node') continue;

    const newNodeId = idMap.get(scope.nodeId);
    if (!newNodeId) continue;

    for (const rule of rulesForScope(project.styles, scope)) {
      styles = putRule(styles, { ...rule, id: ids.styleRule(), scope: nodeScope(newNodeId) });
    }
  }

  return { project: { ...addPage(project, copy), styles }, newId: copy.id };
}

/** `/about` -> `/about-2`, `/about-3`, ... */
function uniquePath(project: Project, path: string): string {
  if (!pathInUse(project, path)) return path;

  for (let n = 2; ; n++) {
    const candidate = normalizePath(`${path}-${n}`);
    if (!pathInUse(project, candidate)) return candidate;
  }
}

/* ---------------------------------------------------------------- styles */

export function setStyles(project: Project, styles: StyleSheet): Project {
  return { ...project, styles };
}

export function setBreakpoints(project: Project, breakpoints: BreakpointSet): Project {
  return { ...project, breakpoints };
}

export function setAssets(project: Project, assets: AssetLibrary): Project {
  return { ...project, assets };
}

export function setSettings(project: Project, settings: ProjectSettings): Project {
  return { ...project, settings };
}

export function renameProject(project: Project, name: string): Project {
  return { ...project, name };
}

/** Every node across every page that uses a class. "Used by 14 elements". */
export function classUsage(project: Project, name: ClassName): readonly NodeId[] {
  return project.pages.flatMap((page) => nodesWithClass(page.tree, name).map((node) => node.id));
}

/** Every asset used by any page. Its complement is the unused-asset sweep. */
export function usedAssets(project: Project): readonly AssetId[] {
  const out = new Set<AssetId>();
  for (const page of project.pages) {
    for (const asset of treeAssets(page.tree)) out.add(asset);
  }
  // Style rules reference assets too — a class's `background-image: url(...)`, or
  // a node-local rule's — and those rules live in the project stylesheet, not in
  // any node's props, so `treeAssets` alone never sees them. Missing this scan
  // makes such an asset look unused, and orphan detection would then offer it for
  // deletion: silent data loss.
  for (const rule of allRules(project.styles)) {
    for (const value of Object.values(rule.declarations)) {
      if (value) referencedStyleAssets(value, out);
    }
  }
  for (const asset of [project.settings.favicon, ...project.pages.map((p) => p.seo.ogImage)]) {
    if (asset) out.add(asset);
  }
  return [...out];
}

/**
 * Assets in the library that nothing references — the unused-asset sweep.
 *
 * The complement of `usedAssets` over the WHOLE project (node props, style rules,
 * favicon, page ogImage). NON-DESTRUCTIVE by contract: an uploaded-but-unplaced
 * asset is "unused" by design, so this REPORTS candidates for the panel and a
 * manual, undoable delete — it never licenses automatic deletion. The same stance
 * as `orphanedNodeScopes` and `orphanedRules`: the model surfaces leaks, it does
 * not destroy the user's work. Returns the `Asset` records, not bare ids, so the
 * panel can show a name and size without a second lookup.
 */
export function orphanedAssets(project: Project): readonly Asset[] {
  const used = new Set<AssetId>(usedAssets(project));
  return allAssets(project.assets).filter((asset) => !used.has(asset.id));
}

/**
 * Node-scoped rules whose node no longer exists in any page.
 *
 * The safety net under `removeNode`'s returned ids and `removePage`'s sweep: if a
 * caller ever forgets to GC, this finds the leak instead of it silently bloating
 * every export forever.
 */
export function orphanedNodeScopes(project: Project): readonly StyleScope[] {
  const live = new Set<NodeId>();
  for (const page of project.pages) {
    for (const nodeId of page.tree.nodes.keys()) live.add(nodeId);
  }

  const out: StyleScope[] = [];
  for (const key of scopeKeys(project.styles)) {
    const scope = parseScopeKey(key);
    if (scope?.kind === 'node' && !live.has(scope.nodeId)) out.push(scope);
  }
  return out;
}

export function validateProject(project: Project): readonly string[] {
  const errors: string[] = [];

  if (project.name.trim() === '') errors.push('Project has no name.');
  if (project.pages.length === 0) errors.push('Project has no pages.');

  const seenPaths = new Set<string>();
  const seenIds = new Set<PageId>();
  for (const page of project.pages) {
    if (seenIds.has(page.id)) errors.push(`Duplicate page id "${page.id}".`);
    seenIds.add(page.id);

    if (seenPaths.has(page.path)) errors.push(`Two pages share the path "${page.path}".`);
    seenPaths.add(page.path);

    errors.push(...validatePage(page));
  }

  return errors;
}
