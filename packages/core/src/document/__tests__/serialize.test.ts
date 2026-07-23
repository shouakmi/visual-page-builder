import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { AssetId, ClassName } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import { boxComponent } from '../../node/builtins.ts';
import { addClass, createNode } from '../../node/node.ts';
import { insertNode } from '../../node/tree.ts';
import { BASE_BREAKPOINT_ID, MOBILE_BREAKPOINT_ID } from '../../style/breakpoints.ts';
import { classScope, nodeScope } from '../../style/rule.ts';
import { setProperty } from '../../style/stylesheet.ts';
import { target } from '../../style/target.ts';
import { keyword, px } from '../../style/values.ts';
import type { Asset } from '../asset.ts';
import { putAsset } from '../asset.ts';
import { createPage, setPageTree } from '../page.ts';
import type { Project } from '../project.ts';
import { addPage, createProject, homePage, setAssets, setStyles, updatePage } from '../project.ts';
import {
  SCHEMA_VERSION,
  createDocumentFile,
  deserializeDocumentFile,
  deserializeProject,
  serializeProject,
} from '../serialize.ts';

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

const BASE = target(BASE_BREAKPOINT_ID);
const MOBILE = target(MOBILE_BREAKPOINT_ID);
const C = (v: string) => unsafeId<ClassName>(v);
const A = (v: string) => unsafeId<AssetId>(v);

const sampleAsset: Asset = {
  id: A('asset-1'),
  name: 'hero.png',
  mimeType: 'image/png',
  byteSize: 1024,
  src: 'blob:hero',
  width: 800,
  height: 600,
  createdAt: '2026-07-01T00:00:00.000Z',
};

/** A box, classed `.btn`, styled at node scope AND class scope, across breakpoints. */
function withStyledBox(project: Project) {
  const page = homePage(project) as NonNullable<ReturnType<typeof homePage>>;
  const box = addClass(createNode(boxComponent, ids), C('btn'));
  const tree = insertNode(page.tree, box, page.tree.root);
  let next = updatePage(project, setPageTree(page, tree));

  let styles = setProperty(next.styles, nodeScope(box.id), BASE, 'width', px(200), ids);
  styles = setProperty(styles, classScope(C('btn')), BASE, 'display', keyword('flex'), ids);
  styles = setProperty(styles, classScope(C('btn')), MOBILE, 'width', px(100), ids);
  next = setStyles(next, styles);

  return { project: next, box };
}

/** Round-trips through the serializer and asserts the byte-shape survives exactly. */
function expectRoundTrips(project: Project) {
  const file = serializeProject(project);
  const result = deserializeProject(file);
  expect(result.ok).toBe(true);
  if (result.ok) expect(serializeProject(result.project)).toEqual(file);
}

describe('serializeProject / deserializeProject — round trips', () => {
  it('round-trips a freshly created project', () => {
    const project = createProject('Site', ids);
    expectRoundTrips(project);

    const file = serializeProject(project);
    expect(file.breakpoints.length).toBeGreaterThan(1);
    expect(file.pages).toHaveLength(1);
  });

  it('round-trips node-scoped and class-scoped styles, across breakpoints, with class order', () => {
    const { project } = withStyledBox(createProject('Site', ids));
    expectRoundTrips(project);

    const file = serializeProject(project);
    expect(file.styles.rules.length).toBeGreaterThan(0);
    expect(file.styles.classOrder).toEqual([C('btn')]);
  });

  it('round-trips unused assets', () => {
    const base = createProject('Site', ids);
    const project = setAssets(base, putAsset(base.assets, sampleAsset));
    expectRoundTrips(project);

    const file = serializeProject(project);
    expect(file.assets).toEqual([sampleAsset]);
  });

  it('round-trips multiple pages', () => {
    const base = createProject('Site', ids);
    const project = addPage(base, createPage('About', '/about', ids));
    expect(project.pages).toHaveLength(2);
    expectRoundTrips(project);
  });
});

describe('deserializeProject — shape validation', () => {
  it('rejects a payload that is not an object', () => {
    const result = deserializeProject('not an object');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'invalid-shape', detail: 'Project is not an object.' },
    });
  });

  it('rejects a project missing a required field', () => {
    const file = serializeProject(createProject('Site', ids));
    const { name: _dropped, ...broken } = file;

    const result = deserializeProject(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-shape');
  });

  it('never throws on deeply malformed nested data', () => {
    // `children` present but not an array reaches `buildNodeTree`'s `for...of`
    // uncaught — exactly the depth a hand-written `typeof`/`Array.isArray` shape
    // check does not reach, and exactly what the try/catch around
    // `deserializeProjectUnsafe` exists to convert into a typed error instead of
    // crashing the caller.
    const { project, box } = withStyledBox(createProject('Site', ids));
    const file = serializeProject(project);
    const page = file.pages[0] as NonNullable<(typeof file.pages)[number]>;
    const brokenNodes = page.nodes.map((node) =>
      node.id === box.id ? { ...node, children: null } : node,
    );
    const broken = { ...file, pages: [{ ...page, nodes: brokenNodes }] };

    expect(() => deserializeProject(broken)).not.toThrow();
    const result = deserializeProject(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-shape');
  });
});

describe('deserializeProject — semantic validation', () => {
  it('rejects a page with a dangling child reference', () => {
    const { project, box } = withStyledBox(createProject('Site', ids));
    const file = serializeProject(project);
    const page = file.pages[0] as NonNullable<(typeof file.pages)[number]>;
    const brokenNodes = page.nodes.map((node) =>
      node.id === box.id ? { ...node, children: [unsafeId('ghost')] } : node,
    );
    const broken = { ...file, pages: [{ ...page, nodes: brokenNodes }] };

    const result = deserializeProject(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation-failed');
      if (result.error.kind === 'validation-failed') {
        expect(result.error.errors.join(' ')).toMatch(/missing child/i);
      }
    }
  });

  it('rejects two pages sharing a path', () => {
    const project = createProject('Site', ids);
    const file = serializeProject(project);
    const original = file.pages[0] as NonNullable<(typeof file.pages)[number]>;
    const duplicate = { ...original, id: unsafeId('other-page') };
    const broken = { ...file, pages: [original, duplicate] };

    const result = deserializeProject(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation-failed');
      if (result.error.kind === 'validation-failed') {
        expect(result.error.errors.join(' ')).toMatch(/share the path/i);
      }
    }
  });
});

describe('createDocumentFile / deserializeDocumentFile', () => {
  it('round-trips the full envelope', () => {
    const { project } = withStyledBox(createProject('Site', ids));
    const file = createDocumentFile(project, '2026-07-22T12:00:00.000Z');

    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.id).toBe(project.id);

    const result = deserializeDocumentFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.id).toBe(project.id);
      expect(result.document.updatedAt).toBe('2026-07-22T12:00:00.000Z');
      expect(serializeProject(result.document.project)).toEqual(serializeProject(project));
    }
  });

  it('rejects an unsupported future schema version', () => {
    const project = createProject('Site', ids);
    const file = { ...createDocumentFile(project, '2026-07-22T12:00:00.000Z'), schemaVersion: 2 };

    const result = deserializeDocumentFile(file);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unsupported-schema-version', found: 2 },
    });
  });

  it('rejects a document missing updatedAt', () => {
    const project = createProject('Site', ids);
    const file = createDocumentFile(project, '2026-07-22T12:00:00.000Z');
    const { updatedAt: _dropped, ...broken } = file;

    const result = deserializeDocumentFile(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-shape');
  });

  it('propagates a project-level shape failure through the envelope', () => {
    const project = createProject('Site', ids);
    const file = createDocumentFile(project, '2026-07-22T12:00:00.000Z');
    const broken = { ...file, project: { ...file.project, name: 123 } };

    const result = deserializeDocumentFile(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-shape');
  });
});
