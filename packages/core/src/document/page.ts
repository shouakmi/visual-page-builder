import type { IdFactory } from '../identity/idFactory.ts';
import type { AssetId, PageId } from '../identity/ids.ts';
import { bodyComponent } from '../node/builtins.ts';
import { createNode } from '../node/node.ts';
import type { NodeTree } from '../node/tree.ts';
import { createTree } from '../node/tree.ts';

/**
 * A page: one node tree, one route, and the metadata that ships in its `<head>`.
 *
 * Phase 1 of the prototype DESIGNED `Project -> Pages[] -> NodeTree` and then
 * implemented `Project -> root` (AUDIT §7.5). Multi-page was silently dropped and
 * never mentioned again — a page builder that builds one page. Restoring it is
 * cheap now and expensive later: every command, every history entry, and every
 * export path would otherwise bake in the assumption that there is one tree, and
 * retrofitting a page dimension through all of them is the kind of change that
 * never gets made.
 */
export interface Page {
  readonly id: PageId;
  readonly name: string;
  /** Route, always leading-slash. `/` is the home page. See `normalizePath`. */
  readonly path: string;
  readonly tree: NodeTree;
  readonly seo: PageSeo;
}

/**
 * Per-page `<head>` content.
 *
 * The prototype had no SEO model at all, which for a page builder whose output is
 * public web pages is a product hole, not a technical one — an exported site with
 * no titles or descriptions is invisible to search.
 */
export interface PageSeo {
  /** Falls back to the page name at export time when absent. */
  readonly title?: string;
  readonly description?: string;
  /** Social preview image. An `AssetId`, so it is tracked and bundled like any other. */
  readonly ogImage?: AssetId;
  readonly canonical?: string;
  /** `noindex` — staging pages, thank-you pages. */
  readonly noIndex?: boolean;
}

export const EMPTY_SEO: PageSeo = {};

export const HOME_PATH = '/';

/**
 * One leading slash, no trailing slash, no double slashes.
 *
 * Normalised at the boundary rather than checked everywhere, because paths are
 * compared for uniqueness (`pathInUse`) and routed on: `/about` and `/about/` and
 * `about` are one page to a user and three distinct strings to a `Map`. Deciding
 * this once here means the router, the exporter (which turns a path into
 * `about/index.html`), and the pages panel cannot disagree.
 */
export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return HOME_PATH;

  const collapsed = `/${trimmed}`.replace(/\/+/g, '/').replace(/\/+$/, '');
  return collapsed === '' ? HOME_PATH : collapsed;
}

/**
 * Is this a route we can accept and export?
 *
 * Paths become FILE PATHS on export (`/about` -> `about/index.html`), so a path
 * containing `..` is a directory traversal that writes outside the output folder,
 * and a backslash or colon breaks on Windows. This is the same class of check as
 * `isValidClassName`, and refused for the same reason: refusing a weird route is a
 * far smaller attack surface than sanitising one correctly.
 */
export function isValidPagePath(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === HOME_PATH) return true;

  if (/[\\:*?"<>|#]/.test(normalized)) return false;
  if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) return false;
  return /^\/[A-Za-z0-9\-._~/]+$/.test(normalized);
}

/**
 * A new page, rooted at a locked Body.
 *
 * The root is minted here rather than accepted from the caller so that every page
 * in every project is guaranteed to have exactly one, and it is guaranteed to be
 * a Body — `rootNode` throws if a tree has no root, and `removeNode` refuses to
 * delete it, so the invariant holds for the page's whole life.
 */
export function createPage(
  name: string,
  path: string,
  ids: IdFactory,
  seo: PageSeo = EMPTY_SEO,
): Page {
  return {
    id: ids.page(),
    name,
    path: normalizePath(path),
    tree: createTree(createNode(bodyComponent, ids)),
    seo,
  };
}

export function setPageTree(page: Page, tree: NodeTree): Page {
  return { ...page, tree };
}

export function renamePage(page: Page, name: string): Page {
  return { ...page, name };
}

export function setPagePath(page: Page, path: string): Page {
  return { ...page, path: normalizePath(path) };
}

export function setPageSeo(page: Page, seo: PageSeo): Page {
  return { ...page, seo };
}

export function validatePage(page: Page): readonly string[] {
  const errors: string[] = [];

  if (page.name.trim() === '') errors.push(`Page "${page.id}" has no name.`);
  if (!isValidPagePath(page.path))
    errors.push(`Page "${page.id}" has an invalid path "${page.path}".`);
  if (page.path !== normalizePath(page.path)) {
    errors.push(`Page "${page.id}" has an unnormalized path "${page.path}".`);
  }

  return errors;
}
