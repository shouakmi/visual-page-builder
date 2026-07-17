import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { AssetId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import { BODY_COMPONENT_ID } from '../../node/builtins.ts';
import { rootNode, validateTree } from '../../node/tree.ts';
import {
  HOME_PATH,
  createPage,
  isValidPagePath,
  normalizePath,
  renamePage,
  setPagePath,
  setPageSeo,
  validatePage,
} from '../page.ts';

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

describe('createPage', () => {
  it('roots the tree at a body', () => {
    const page = createPage('Home', '/', ids);

    expect(rootNode(page.tree).component).toBe(BODY_COMPONENT_ID);
    expect(page.tree.nodes.size).toBe(1);
    expect(validateTree(page.tree)).toEqual([]);
  });

  it('normalizes the path it is given', () => {
    expect(createPage('About', 'about/', ids).path).toBe('/about');
  });

  it('validates clean', () => {
    expect(validatePage(createPage('Home', '/', ids))).toEqual([]);
  });
});

describe('normalizePath', () => {
  it('adds one leading slash', () => {
    expect(normalizePath('about')).toBe('/about');
    expect(normalizePath('/about')).toBe('/about');
  });

  it('drops trailing slashes', () => {
    expect(normalizePath('/about/')).toBe('/about');
    expect(normalizePath('/about///')).toBe('/about');
  });

  it('collapses repeated slashes', () => {
    expect(normalizePath('//blog//post')).toBe('/blog/post');
  });

  it('maps every spelling of home to one', () => {
    expect(normalizePath('/')).toBe(HOME_PATH);
    expect(normalizePath('')).toBe(HOME_PATH);
    expect(normalizePath('   ')).toBe(HOME_PATH);
  });

  it('trims', () => {
    expect(normalizePath('  /about  ')).toBe('/about');
  });

  it('is idempotent', () => {
    expect(normalizePath(normalizePath('//about//'))).toBe('/about');
  });
});

describe('isValidPagePath', () => {
  it('accepts normal routes', () => {
    expect(isValidPagePath('/')).toBe(true);
    expect(isValidPagePath('/about')).toBe(true);
    expect(isValidPagePath('/blog/my-post_2.html')).toBe(true);
  });

  /**
   * Paths become file paths on export, so `..` writes outside the output folder.
   * Same class of check as isValidClassName, refused for the same reason.
   */
  it('refuses directory traversal', () => {
    expect(isValidPagePath('/../secrets')).toBe(false);
    expect(isValidPagePath('/blog/../../etc')).toBe(false);
    expect(isValidPagePath('/./x')).toBe(false);
  });

  it('refuses characters that break a filesystem or a URL', () => {
    for (const path of ['/a\\b', '/a:b', '/a*b', '/a?b', '/a"b', '/a<b', '/a>b', '/a|b', '/a#b']) {
      expect(isValidPagePath(path)).toBe(false);
    }
  });

  it('refuses spaces and other unencoded characters', () => {
    expect(isValidPagePath('/my page')).toBe(false);
    expect(isValidPagePath('/café')).toBe(false);
  });
});

describe('mutators', () => {
  it('renames', () => {
    expect(renamePage(createPage('Home', '/', ids), 'Start').name).toBe('Start');
  });

  it('normalizes on setPagePath', () => {
    expect(setPagePath(createPage('Home', '/', ids), 'about//').path).toBe('/about');
  });

  it('sets seo', () => {
    const page = setPageSeo(createPage('Home', '/', ids), {
      title: 'Home',
      ogImage: unsafeId<AssetId>('og'),
      noIndex: true,
    });

    expect(page.seo.title).toBe('Home');
    expect(page.seo.ogImage).toBe('og');
    expect(page.seo.noIndex).toBe(true);
  });
});

describe('validatePage', () => {
  it('catches a nameless page', () => {
    expect(validatePage(createPage('  ', '/', ids)).join(' ')).toMatch(/no name/);
  });

  it('catches an invalid path', () => {
    const page = { ...createPage('Home', '/', ids), path: '/../x' };
    expect(validatePage(page).join(' ')).toMatch(/invalid path/);
  });

  it('catches an unnormalized path that bypassed the constructor', () => {
    const page = { ...createPage('Home', '/', ids), path: '/about/' };
    expect(validatePage(page).join(' ')).toMatch(/unnormalized/);
  });
});
