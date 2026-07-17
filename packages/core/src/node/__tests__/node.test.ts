import { beforeEach, describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, type IdFactory } from '../../identity/idFactory.ts';
import type { ClassName } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import { boxComponent, headingComponent, imageComponent } from '../builtins.ts';
import {
  addClass,
  createNode,
  hasClass,
  nodeName,
  removeClass,
  renameNode,
  setClasses,
  setHidden,
  setLocked,
  setNodeProp,
  setNodeProps,
  unsetNodeProp,
} from '../node.ts';
import { propString } from '../props.ts';

const C = (v: string) => unsafeId<ClassName>(v);

let ids: IdFactory;
beforeEach(() => {
  ids = createDeterministicIdFactory();
});

describe('createNode', () => {
  it('applies the component defaults', () => {
    const node = createNode(headingComponent, ids);

    expect(node.component).toBe(headingComponent.id);
    expect(node.props).toEqual({ text: propString('Heading'), level: propString('h2') });
    expect(node.children).toEqual([]);
  });

  it('mints a fresh id per node', () => {
    expect(createNode(boxComponent, ids).id).not.toBe(createNode(boxComponent, ids).id);
  });

  it('lets overrides win over defaults', () => {
    const node = createNode(headingComponent, ids, { props: { text: propString('Hi') } });

    expect(node.props.text).toEqual(propString('Hi'));
    expect(node.props.level).toEqual(propString('h2'));
  });

  it('applies the component default classes', () => {
    const node = createNode({ ...boxComponent, defaultClasses: [C('card')] }, ids);
    expect(node.classes).toEqual(['card']);
  });

  it('omits an absent name rather than storing undefined', () => {
    expect('name' in createNode(boxComponent, ids)).toBe(false);
  });
});

describe('nodeName', () => {
  it('prefers the user name', () => {
    const node = renameNode(createNode(boxComponent, ids), 'Hero');
    expect(nodeName(node, boxComponent)).toBe('Hero');
  });

  /** A tree of unnamed boxes should read as "Box", not "Untitled 47". */
  it('falls back to the component label', () => {
    expect(nodeName(createNode(boxComponent, ids), boxComponent)).toBe('Box');
  });

  it('falls back to the component id when the definition is unknown', () => {
    expect(nodeName(createNode(boxComponent, ids))).toBe('vpb:box');
  });
});

describe('props', () => {
  it('sets and unsets', () => {
    const node = createNode(imageComponent, ids);
    const withAlt = setNodeProp(node, 'alt', propString('Hero'));

    expect(withAlt.props.alt).toEqual(propString('Hero'));
    expect(unsetNodeProp(withAlt, 'alt').props.alt).toBeUndefined();
  });

  it('returns the same node when unsetting something absent', () => {
    const node = createNode(boxComponent, ids);
    expect(unsetNodeProp(node, 'nope')).toBe(node);
  });

  it('replaces the whole prop set', () => {
    const node = createNode(headingComponent, ids);
    expect(setNodeProps(node, { text: propString('x') }).props).toEqual({ text: propString('x') });
  });

  it('does not mutate the original', () => {
    const node = createNode(imageComponent, ids);
    const next = setNodeProp(node, 'alt', propString('Hero'));

    // `alt` defaults to '', so the original must still hold the default while the
    // copy holds the new value.
    expect(node.props.alt).toEqual(propString(''));
    expect(next.props.alt).toEqual(propString('Hero'));
  });
});

describe('classes', () => {
  it('adds, reads, and removes', () => {
    const node = addClass(createNode(boxComponent, ids), C('btn'));

    expect(hasClass(node, C('btn'))).toBe(true);
    expect(hasClass(removeClass(node, C('btn')), C('btn'))).toBe(false);
  });

  /** Order is what the user sees in the style panel's class chips. */
  it('appends in order', () => {
    let node = createNode(boxComponent, ids);
    node = addClass(node, C('a'));
    node = addClass(node, C('b'));

    expect(node.classes).toEqual(['a', 'b']);
  });

  it('does not duplicate or reorder on re-add', () => {
    let node = createNode(boxComponent, ids);
    node = addClass(node, C('a'));
    node = addClass(node, C('b'));
    const same = addClass(node, C('a'));

    expect(same).toBe(node);
    expect(same.classes).toEqual(['a', 'b']);
  });

  it('ignores removing a class it does not have', () => {
    const node = createNode(boxComponent, ids);
    expect(removeClass(node, C('nope'))).toBe(node);
  });

  it('setClasses replaces and deduplicates', () => {
    const node = setClasses(createNode(boxComponent, ids), [C('a'), C('b'), C('a')]);
    expect(node.classes).toEqual(['a', 'b']);
  });
});

describe('flags', () => {
  it('sets locked and hidden', () => {
    const node = createNode(boxComponent, ids);

    expect(setLocked(node, true).locked).toBe(true);
    expect(setHidden(node, true).hidden).toBe(true);
  });

  /** Delete rather than store `false`, so saved projects stay free of noise. */
  it('strips the flag instead of storing false', () => {
    const node = setLocked(createNode(boxComponent, ids), true);
    const unlocked = setLocked(node, false);

    expect('locked' in unlocked).toBe(false);
  });

  it('is a no-op when clearing an unset flag', () => {
    const node = createNode(boxComponent, ids);
    expect(setHidden(node, false)).toBe(node);
  });
});

describe('renameNode', () => {
  it('trims', () => {
    expect(renameNode(createNode(boxComponent, ids), '  Hero  ').name).toBe('Hero');
  });

  /** Clearing the name reverts to the component label, not a blank row. */
  it('drops the name when set to empty or whitespace', () => {
    const named = renameNode(createNode(boxComponent, ids), 'Hero');

    expect('name' in renameNode(named, '')).toBe(false);
    expect('name' in renameNode(named, '   ')).toBe(false);
    expect('name' in renameNode(named, undefined)).toBe(false);
  });

  it('is a no-op when clearing an already-absent name', () => {
    const node = createNode(boxComponent, ids);
    expect(renameNode(node, '')).toBe(node);
  });
});
