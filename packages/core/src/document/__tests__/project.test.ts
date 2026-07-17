import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { AssetId, ClassName, NodeId, PageId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import { boxComponent } from '../../node/builtins.ts';
import { addClass, createNode } from '../../node/node.ts';
import { propAsset } from '../../node/props.ts';
import { insertNode, updateNode } from '../../node/tree.ts';
import { BASE_BREAKPOINT_ID, defaultBreakpoints } from '../../style/breakpoints.ts';
import { classScope, nodeScope } from '../../style/rule.ts';
import { EMPTY_STYLESHEET, findRule, ruleCount, setProperty } from '../../style/stylesheet.ts';
import { target } from '../../style/target.ts';
import { px } from '../../style/values.ts';
import { createAssetLibrary } from '../asset.ts';
import { createPage, setPageTree } from '../page.ts';
import {
  addPage,
  classUsage,
  createProject,
  duplicatePage,
  getPage,
  homePage,
  movePage,
  orphanedNodeScopes,
  pageAtPath,
  pathInUse,
  removePage,
  renameProject,
  setAssets,
  setBreakpoints,
  setSettings,
  setStyles,
  updatePage,
  updatePageBy,
  usedAssets,
  validateProject,
} from '../project.ts';

const BASE = target(BASE_BREAKPOINT_ID);
const C = (v: string) => unsafeId<ClassName>(v);

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

/** Adds a box to a page's tree and returns both. */
const withBox = (project: ReturnType<typeof createProject>, pageId: PageId) => {
  const page = getPage(project, pageId) as NonNullable<ReturnType<typeof getPage>>;
  const box = createNode(boxComponent, ids);
  const tree = insertNode(page.tree, box, page.tree.root);
  return { project: updatePage(project, setPageTree(page, tree)), box };
};

describe('createProject', () => {
  /** The prototype was `Project -> root`: multi-page was designed then dropped. */
  it('starts with one home page and a tree', () => {
    const project = createProject('Site', ids);

    expect(project.pages).toHaveLength(1);
    expect(project.pages[0]?.path).toBe('/');
    expect(project.pages[0]?.tree.nodes.size).toBe(1);
  });

  it('carries the pieces the prototype dropped', () => {
    const project = createProject('Site', ids);

    expect(project.styles).toBe(EMPTY_STYLESHEET);
    expect(project.breakpoints.breakpoints.length).toBeGreaterThan(1);
    expect(project.assets.assets.size).toBe(0);
    expect(project.settings.language).toBe('en');
  });

  it('validates clean', () => {
    expect(validateProject(createProject('Site', ids))).toEqual([]);
  });
});

describe('pages', () => {
  it('adds and finds', () => {
    const project = addPage(createProject('Site', ids), createPage('About', '/about', ids));

    expect(project.pages).toHaveLength(2);
    expect(pageAtPath(project, '/about')?.name).toBe('About');
  });

  it('finds by unnormalized path', () => {
    const project = addPage(createProject('Site', ids), createPage('About', '/about', ids));
    expect(pageAtPath(project, 'about/')?.name).toBe('About');
  });

  /**
   * Two pages at one route overwrite each other at export — the user loses a page
   * they can still see in the panel.
   */
  it('refuses a colliding path', () => {
    const project = addPage(createProject('Site', ids), createPage('About', '/about', ids));
    const next = addPage(project, createPage('Other', '/about', ids));

    expect(next).toBe(project);
    expect(pathInUse(project, '/about')).toBe(true);
  });

  it('refuses a duplicate page id', () => {
    const project = createProject('Site', ids);
    const existing = project.pages[0] as NonNullable<(typeof project.pages)[0]>;

    expect(addPage(project, { ...existing, path: '/elsewhere' })).toBe(project);
  });

  it('updates a page', () => {
    const project = createProject('Site', ids);
    const page = project.pages[0] as NonNullable<(typeof project.pages)[0]>;
    const next = updatePage(project, { ...page, name: 'Renamed' });

    expect(getPage(next, page.id)?.name).toBe('Renamed');
  });

  it('refuses an update that collides with another path', () => {
    let project = createProject('Site', ids);
    project = addPage(project, createPage('About', '/about', ids));
    const home = project.pages[0] as NonNullable<(typeof project.pages)[0]>;

    expect(updatePage(project, { ...home, path: '/about' })).toBe(project);
  });

  it('lets a page keep its own path on update', () => {
    const project = createProject('Site', ids);
    const home = project.pages[0] as NonNullable<(typeof project.pages)[0]>;
    const next = updatePage(project, { ...home, path: '/', name: 'Start' });

    expect(getPage(next, home.id)?.name).toBe('Start');
  });

  it('updatePageBy passes the current page', () => {
    const project = createProject('Site', ids);
    const id = project.pages[0]?.id as PageId;
    const next = updatePageBy(project, id, (page) => ({ ...page, name: 'Home 2' }));

    expect(getPage(next, id)?.name).toBe('Home 2');
  });

  it('homePage prefers the root path', () => {
    let project = createProject('Site', ids);
    project = addPage(project, createPage('About', '/about', ids));

    expect(homePage(project)?.path).toBe('/');
  });

  it('reorders', () => {
    let project = createProject('Site', ids);
    project = addPage(project, createPage('About', '/about', ids));
    project = addPage(project, createPage('Blog', '/blog', ids));
    const blogId = pageAtPath(project, '/blog')?.id as PageId;

    expect(movePage(project, blogId, 0).pages.map((p) => p.path)).toEqual(['/blog', '/', '/about']);
  });

  it('ignores reordering an unknown page', () => {
    const project = createProject('Site', ids);
    expect(movePage(project, unsafeId('nope'), 0)).toBe(project);
  });
});

describe('removePage', () => {
  it('removes', () => {
    let project = createProject('Site', ids);
    project = addPage(project, createPage('About', '/about', ids));
    const aboutId = pageAtPath(project, '/about')?.id as PageId;

    expect(removePage(project, aboutId).pages).toHaveLength(1);
  });

  /** A project with no pages has nothing to show, so every consumer would need
   * an "empty project" branch. */
  it('refuses to remove the last page', () => {
    const project = createProject('Site', ids);
    expect(removePage(project, project.pages[0]?.id as PageId)).toBe(project);
  });

  it('ignores an unknown page', () => {
    let project = createProject('Site', ids);
    project = addPage(project, createPage('About', '/about', ids));

    expect(removePage(project, unsafeId('nope'))).toBe(project);
  });

  /**
   * Node-scoped rules are keyed by node id and live in the PROJECT sheet. Without
   * this sweep they are saved forever and emitted into every export.
   */
  it('sweeps the style rules of the nodes it deletes', () => {
    let project = addPage(createProject('Site', ids), createPage('About', '/about', ids));
    const aboutId = pageAtPath(project, '/about')?.id as PageId;

    const added = withBox(project, aboutId);
    project = setStyles(
      added.project,
      setProperty(added.project.styles, nodeScope(added.box.id), BASE, 'paddingTop', px(8), ids),
    );
    expect(ruleCount(project.styles)).toBe(1);

    const next = removePage(project, aboutId);
    expect(ruleCount(next.styles)).toBe(0);
    expect(orphanedNodeScopes(next)).toEqual([]);
  });

  /** Class rules are shared across pages — deleting a page must not delete them. */
  it('leaves class rules alone', () => {
    let project = addPage(createProject('Site', ids), createPage('About', '/about', ids));
    project = setStyles(
      project,
      setProperty(project.styles, classScope(C('btn')), BASE, 'paddingTop', px(8), ids),
    );

    const next = removePage(project, pageAtPath(project, '/about')?.id as PageId);
    expect(findRule(next.styles, classScope(C('btn')), BASE)).toBeDefined();
  });
});

describe('duplicatePage', () => {
  it('copies the tree with fresh node ids', () => {
    const project = createProject('Site', ids);
    const added = withBox(project, project.pages[0]?.id as PageId);
    const { project: next, newId } = duplicatePage(
      added.project,
      added.project.pages[0]?.id as PageId,
      ids,
    );

    const copy = getPage(next, newId as PageId);
    expect(copy?.tree.nodes.size).toBe(2);
    expect([...(copy?.tree.nodes.keys() ?? [])]).not.toContain(added.box.id);
    expect(validateProject(next)).toEqual([]);
  });

  it('gives the copy a free path and a copy name', () => {
    const project = createProject('Site', ids);
    const { project: next, newId } = duplicatePage(project, project.pages[0]?.id as PageId, ids);

    expect(getPage(next, newId as PageId)?.path).toBe('/-2');
    expect(getPage(next, newId as PageId)?.name).toBe('Home copy');
  });

  it('avoids an already-taken copy path', () => {
    let project = addPage(createProject('Site', ids), createPage('About', '/about', ids));
    const aboutId = pageAtPath(project, '/about')?.id as PageId;
    project = duplicatePage(project, aboutId, ids).project;
    const second = duplicatePage(project, aboutId, ids);

    expect(getPage(second.project, second.newId as PageId)?.path).toBe('/about-3');
  });

  /**
   * Without the rule copy, a duplicated page renders unstyled wherever the
   * original used a per-element override — WYSIWYG broken on a routine action.
   */
  it('copies node-scoped style rules onto the new nodes', () => {
    const project = createProject('Site', ids);
    const added = withBox(project, project.pages[0]?.id as PageId);
    const styled = setStyles(
      added.project,
      setProperty(added.project.styles, nodeScope(added.box.id), BASE, 'paddingTop', px(40), ids),
    );

    const { project: next, newId } = duplicatePage(styled, styled.pages[0]?.id as PageId, ids);
    const copy = getPage(next, newId as PageId);
    const copiedBox = [...(copy?.tree.nodes.values() ?? [])].find(
      (n) => n.component === boxComponent.id,
    );

    expect(ruleCount(next.styles)).toBe(2);
    expect(
      findRule(next.styles, nodeScope(copiedBox?.id as NodeId), BASE)?.declarations.paddingTop,
    ).toEqual(px(40));
    // The original is untouched.
    expect(findRule(next.styles, nodeScope(added.box.id), BASE)?.declarations.paddingTop).toEqual(
      px(40),
    );
  });

  it('ignores an unknown page', () => {
    const project = createProject('Site', ids);
    const { project: next, newId } = duplicatePage(project, unsafeId('nope'), ids);

    expect(next).toBe(project);
    expect(newId).toBeUndefined();
  });
});

describe('usage tracking', () => {
  it('finds class usage across every page', () => {
    let project = addPage(createProject('Site', ids), createPage('About', '/about', ids));
    for (const page of [...project.pages]) {
      const box = createNode(boxComponent, ids);
      let tree = insertNode(page.tree, box, page.tree.root);
      tree = updateNode(tree, addClass(box, C('btn')));
      project = updatePage(project, setPageTree(page, tree));
    }

    expect(classUsage(project, C('btn'))).toHaveLength(2);
    expect(classUsage(project, C('nope'))).toEqual([]);
  });

  it('finds assets used by nodes, seo, and settings', () => {
    const project = createProject('Site', ids);
    const page = project.pages[0] as NonNullable<(typeof project.pages)[0]>;
    const image = createNode(boxComponent, ids, { props: { src: propAsset(unsafeId('hero')) } });
    let next = updatePage(project, setPageTree(page, insertNode(page.tree, image, page.tree.root)));
    next = updatePageBy(next, page.id, (p) => ({
      ...p,
      seo: { ogImage: unsafeId<AssetId>('og') },
    }));
    next = setSettings(next, { favicon: unsafeId<AssetId>('icon') });

    expect([...usedAssets(next)].sort()).toEqual(['hero', 'icon', 'og']);
  });

  /** The safety net under removeNode's returned ids and removePage's sweep. */
  it('reports node scopes whose node is gone', () => {
    const project = createProject('Site', ids);
    const styled = setStyles(
      project,
      setProperty(project.styles, nodeScope(unsafeId('ghost')), BASE, 'paddingTop', px(8), ids),
    );

    expect(orphanedNodeScopes(styled)).toEqual([nodeScope(unsafeId('ghost'))]);
  });

  it('does not report a live node scope', () => {
    const project = createProject('Site', ids);
    const added = withBox(project, project.pages[0]?.id as PageId);
    const styled = setStyles(
      added.project,
      setProperty(added.project.styles, nodeScope(added.box.id), BASE, 'paddingTop', px(8), ids),
    );

    expect(orphanedNodeScopes(styled)).toEqual([]);
  });
});

describe('setters', () => {
  it('replace each slice', () => {
    let project = createProject('Site', ids);
    project = renameProject(project, 'Renamed');
    project = setBreakpoints(project, defaultBreakpoints());
    project = setAssets(project, createAssetLibrary([]));
    project = setSettings(project, { siteName: 'Acme' });

    expect(project.name).toBe('Renamed');
    expect(project.settings.siteName).toBe('Acme');
    expect(validateProject(project)).toEqual([]);
  });
});

describe('validateProject', () => {
  it('catches a nameless project', () => {
    expect(validateProject(createProject('  ', ids)).join(' ')).toMatch(/no name/);
  });

  it('catches two pages at one path', () => {
    const project = createProject('Site', ids);
    const home = project.pages[0] as NonNullable<(typeof project.pages)[0]>;
    const forced = { ...project, pages: [home, { ...home, id: unsafeId<PageId>('p2') }] };

    expect(validateProject(forced).join(' ')).toMatch(/share the path/);
  });

  it('catches a duplicate page id', () => {
    const project = createProject('Site', ids);
    const home = project.pages[0] as NonNullable<(typeof project.pages)[0]>;
    const forced = { ...project, pages: [home, { ...home, path: '/x' }] };

    expect(validateProject(forced).join(' ')).toMatch(/Duplicate page id/);
  });

  it('catches an empty project', () => {
    const project = { ...createProject('Site', ids), pages: [] };
    expect(validateProject(project).join(' ')).toMatch(/no pages/);
  });
});
