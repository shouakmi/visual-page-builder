import type { ClassName, NodeId, PageId, ProjectId } from '../identity/ids.ts';
import { unsafeId } from '../identity/ids.ts';
import type { Node } from '../node/node.ts';
import { buildNodeTree, validateTree } from '../node/tree.ts';
import type { Breakpoint } from '../style/breakpoints.ts';
import { validateBreakpointSet } from '../style/breakpoints.ts';
import type { StyleRule } from '../style/rule.ts';
import {
  allRules,
  createStyleSheet,
  setClassOrder,
  validateStyleSheet,
} from '../style/stylesheet.ts';
import type { Asset } from './asset.ts';
import { allAssets, createAssetLibrary } from './asset.ts';
import type { Page, PageSeo } from './page.ts';
import type { Project, ProjectSettings } from './project.ts';
import { validateProject } from './project.ts';

/**
 * PROJECT SERIALIZATION — THE PHASE F1 BOUNDARY.
 *
 * `Project` is not JSON-safe: `NodeTree.nodes`/`.parents`, `StyleSheet.rules`/
 * `.index`, and `AssetLibrary.assets` are all `Map`s, and `JSON.stringify` drops
 * a `Map`'s entries silently rather than failing loudly. `ProjectFileV1` is the
 * array-shaped mirror every one of those Maps already has a constructor for
 * (`createStyleSheet`, `createAssetLibrary`) or, for the node tree, gains one
 * here (`buildNodeTree`) — so serializing is "read the Maps into arrays" and
 * deserializing is "hand the arrays back to the constructors that already
 * maintain the derived state correctly."
 *
 * TWO VALIDATION LAYERS, ALWAYS BOTH, ALWAYS IN THIS ORDER. A loaded document is
 * untrusted input — hand-edited, corrupted, or from a future app version — so
 * nothing here trusts `unknown` JSON on the strength of a successful
 * `JSON.parse` alone:
 *
 *   1. SHAPE — is this even an object with the right field types. Every
 *      `deserialize*` function checks this by hand, field by field, the same
 *      way `parseScopeKey`/`parseTargetKey` do, because this codebase has no
 *      schema-validation dependency and the brief has no placeholder
 *      implementations to reach for one just to skip writing this.
 *   2. SEMANTIC — once shaped correctly, `validateTree` (per page),
 *      `validateStyleSheet`, `validateBreakpointSet`, and the ALREADY-EXISTING
 *      `validateProject` run over the assembled candidate. Nothing here
 *      reimplements those checks.
 *
 * NEVER THROWS. `deserializeProject`'s hand-written shape checks catch the
 * common corruption (a missing field, a wrong type) with a specific message;
 * anything deeper that would otherwise throw inside core's own constructors —
 * a rule whose `scope` is present but not an object, say — is caught by the
 * try/catch around the whole reconstruction and reported the same way, rather
 * than by exhaustively re-validating every nested `StyleValue`/`PropValue`
 * variant by hand. Untrusted JSON must never crash the caller; see the
 * corruption-handling requirement this exists to satisfy.
 *
 * SCHEMA VERSIONING EXISTS FROM THE FIRST VERSION, WITH ZERO MIGRATIONS. The
 * chain (`MIGRATIONS`) is empty today — version 1 is the only version that has
 * ever existed — but the mechanism has to exist now: retrofitting it once real
 * user documents are on disk is the expensive path. A `schemaVersion` newer
 * than this app understands is refused outright, never guessed at.
 */

export const SCHEMA_VERSION = 1;

export interface PageFileV1 {
  readonly id: PageId;
  readonly name: string;
  readonly path: string;
  readonly seo: PageSeo;
  /** `NodeTree.parents` is derived and is not stored; `buildNodeTree` rebuilds it. */
  readonly root: NodeId;
  readonly nodes: readonly Node[];
}

export interface ProjectFileV1 {
  readonly id: ProjectId;
  readonly name: string;
  readonly settings: ProjectSettings;
  readonly pages: readonly PageFileV1[];
  /** `StyleSheet.index` is derived and is not stored; `createStyleSheet` rebuilds it. */
  readonly styles: {
    readonly rules: readonly StyleRule[];
    readonly classOrder: readonly ClassName[];
  };
  readonly breakpoints: readonly Breakpoint[];
  readonly assets: readonly Asset[];
}

/** The envelope written to storage — what `StorageAdapter.saveDocument` accepts. */
export interface DocumentFile {
  readonly schemaVersion: number;
  readonly id: ProjectId;
  /** ISO 8601. Set by the caller's clock, never `Date.now()` inside this file — see `@vpb/state`'s `now()` seam. */
  readonly updatedAt: string;
  readonly project: ProjectFileV1;
}

/** What a successful `deserializeDocumentFile` hands the store — ready to edit. */
export interface LoadedDocument {
  readonly schemaVersion: number;
  readonly id: ProjectId;
  readonly updatedAt: string;
  readonly project: Project;
}

export type DeserializeError =
  | { readonly kind: 'invalid-shape'; readonly detail: string }
  | { readonly kind: 'unsupported-schema-version'; readonly found: number }
  | { readonly kind: 'validation-failed'; readonly errors: readonly string[] };

export type DeserializeProjectResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly error: DeserializeError };

export type DeserializeDocumentResult =
  | { readonly ok: true; readonly document: LoadedDocument }
  | { readonly ok: false; readonly error: DeserializeError };

/* ---------------------------------------------------------------- serialize */

export function serializeProject(project: Project): ProjectFileV1 {
  return {
    id: project.id,
    name: project.name,
    settings: project.settings,
    pages: project.pages.map(serializePage),
    styles: { rules: allRules(project.styles), classOrder: project.styles.classOrder },
    breakpoints: project.breakpoints.breakpoints,
    assets: allAssets(project.assets),
  };
}

function serializePage(page: Page): PageFileV1 {
  return {
    id: page.id,
    name: page.name,
    path: page.path,
    seo: page.seo,
    root: page.tree.root,
    nodes: [...page.tree.nodes.values()],
  };
}

/** `serializeProject` plus the envelope — the one call site `save()` needs. */
export function createDocumentFile(project: Project, updatedAt: string): DocumentFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: project.id,
    updatedAt,
    project: serializeProject(project),
  };
}

/* -------------------------------------------------------------- deserialize */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A schema-version migration chain, empty today.
 *
 * `MIGRATIONS[n]` turns a raw payload written at version `n` into the shape
 * version `n + 1` expects. Applied in a loop so a file several versions old
 * walks forward one step at a time; a version with no registered step (every
 * version today, since only version 1 has ever existed, and any version below
 * it does not exist) is refused rather than guessed at.
 */
const MIGRATIONS: Readonly<Record<number, (raw: unknown) => unknown>> = {};

function migrateProjectPayload(
  raw: unknown,
  schemaVersion: number,
):
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly error: DeserializeError } {
  let version = schemaVersion;
  let payload = raw;

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      return { ok: false, error: { kind: 'unsupported-schema-version', found: schemaVersion } };
    }
    payload = step(payload);
    version += 1;
  }
  if (version > SCHEMA_VERSION) {
    return { ok: false, error: { kind: 'unsupported-schema-version', found: schemaVersion } };
  }
  return { ok: true, raw: payload };
}

/**
 * Untrusted `ProjectFileV1`-shaped JSON in, a validated `Project` (or a typed
 * error) out. Standalone from `deserializeDocumentFile` on purpose — the Phase G
 * importer will eventually hand this function project-shaped JSON with no
 * document envelope around it at all.
 */
export function deserializeProject(raw: unknown): DeserializeProjectResult {
  try {
    return deserializeProjectUnsafe(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { kind: 'invalid-shape', detail: message } };
  }
}

function deserializeProjectUnsafe(raw: unknown): DeserializeProjectResult {
  if (!isRecord(raw)) {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'Project is not an object.' } };
  }

  const { id, name, settings, pages, styles, breakpoints, assets } = raw;

  if (typeof id !== 'string' || id === '') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project id is missing or not a string.' },
    };
  }
  if (typeof name !== 'string') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project name is missing or not a string.' },
    };
  }
  if (!isRecord(settings)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project settings is missing or not an object.' },
    };
  }
  if (!Array.isArray(pages)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project pages is missing or not an array.' },
    };
  }
  if (!isRecord(styles) || !Array.isArray(styles.rules) || !Array.isArray(styles.classOrder)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project styles is missing or malformed.' },
    };
  }
  if (!Array.isArray(breakpoints)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project breakpoints is missing or not an array.' },
    };
  }
  if (!Array.isArray(assets)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project assets is missing or not an array.' },
    };
  }

  const deserializedPages: Page[] = [];
  for (const rawPage of pages) {
    const result = deserializePage(rawPage);
    if (!result.ok) return result;
    deserializedPages.push(result.page);
  }

  const sheet = setClassOrder(
    createStyleSheet(styles.rules as StyleRule[]),
    styles.classOrder as ClassName[],
  );

  const project: Project = {
    id: unsafeId<ProjectId>(id),
    name,
    settings: settings as ProjectSettings,
    pages: deserializedPages,
    styles: sheet,
    breakpoints: { breakpoints: breakpoints as Breakpoint[] },
    assets: createAssetLibrary(assets as Asset[]),
  };

  const errors = [
    ...validateBreakpointSet(project.breakpoints.breakpoints),
    ...validateStyleSheet(project.styles),
    ...validateProject(project),
  ];
  if (errors.length > 0) return { ok: false, error: { kind: 'validation-failed', errors } };

  return { ok: true, project };
}

function deserializePage(
  raw: unknown,
):
  | { readonly ok: true; readonly page: Page }
  | { readonly ok: false; readonly error: DeserializeError } {
  if (!isRecord(raw)) {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'Page is not an object.' } };
  }

  const { id, name, path, seo, root, nodes } = raw;

  if (typeof id !== 'string' || id === '') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Page id is missing or not a string.' },
    };
  }
  if (typeof name !== 'string') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Page name is missing or not a string.' },
    };
  }
  if (typeof path !== 'string') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Page path is missing or not a string.' },
    };
  }
  if (!isRecord(seo)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Page seo is missing or not an object.' },
    };
  }
  if (typeof root !== 'string' || root === '') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Page root is missing or not a string.' },
    };
  }
  if (!Array.isArray(nodes)) {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Page nodes is missing or not an array.' },
    };
  }

  const tree = buildNodeTree(nodes as Node[], unsafeId<NodeId>(root));
  const treeErrors = validateTree(tree);
  if (treeErrors.length > 0) {
    return { ok: false, error: { kind: 'validation-failed', errors: treeErrors } };
  }

  return { ok: true, page: { id: unsafeId<PageId>(id), name, path, seo: seo as PageSeo, tree } };
}

/**
 * Untrusted `DocumentFile`-shaped JSON in — what an adapter's `loadDocument`
 * hands back — a `LoadedDocument` ready for the store, or a typed error, out.
 * Runs the migration chain, then delegates to `deserializeProject` for the
 * `project` field, so the two validation layers described above happen exactly
 * once each.
 */
export function deserializeDocumentFile(raw: unknown): DeserializeDocumentResult {
  if (!isRecord(raw)) {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'Document is not an object.' } };
  }

  const { schemaVersion, id, updatedAt, project } = raw;

  if (typeof schemaVersion !== 'number') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'schemaVersion is missing or not a number.' },
    };
  }
  if (typeof id !== 'string' || id === '') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Document id is missing or not a string.' },
    };
  }
  if (typeof updatedAt !== 'string' || updatedAt === '') {
    return {
      ok: false,
      error: { kind: 'invalid-shape', detail: 'updatedAt is missing or not a string.' },
    };
  }

  const migrated = migrateProjectPayload(project, schemaVersion);
  if (!migrated.ok) return migrated;

  const projectResult = deserializeProject(migrated.raw);
  if (!projectResult.ok) return projectResult;

  return {
    ok: true,
    document: {
      schemaVersion: SCHEMA_VERSION,
      id: unsafeId<ProjectId>(id),
      updatedAt,
      project: projectResult.project,
    },
  };
}
