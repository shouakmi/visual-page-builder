import { describe, expect, it } from 'vitest';

import { hex } from '../color.ts';
import {
  acceptsValue,
  cssPropertyName,
  isInherited,
  isStyleProperty,
  propertiesInGroup,
  propertyDefinition,
  STYLE_PROPERTIES,
  STYLE_PROPERTY_NAMES,
  type PropertyGroup,
  type StyleProperty,
} from '../properties.ts';
import { color, keyword, ms, number, px, raw, str, token, transform, url } from '../values.ts';
import type { TokenId } from '../../identity/ids.ts';

const T = (v: string) => v as TokenId;

/**
 * The catalog is data, and data rots quietly. These assertions are cheap and
 * catch the copy-paste errors that are otherwise invisible in a 90-entry table —
 * a duplicated cssName, a camelCase name that never got kebabed, a property
 * whose keywords contradict its accepted kinds.
 */
describe('catalog integrity', () => {
  it('is non-empty and covers every specified group', () => {
    const groups: PropertyGroup[] = [
      'layout',
      'flex',
      'grid',
      'typography',
      'background',
      'border',
      'effects',
      'transform',
      'transition',
      'animation',
      'interactivity',
    ];
    for (const group of groups) {
      expect(propertiesInGroup(group).length, `${group} has no properties`).toBeGreaterThan(0);
    }
  });

  it('has a unique cssName per property', () => {
    const seen = new Map<string, StyleProperty>();
    for (const name of STYLE_PROPERTY_NAMES) {
      const css = cssPropertyName(name);
      const previous = seen.get(css);
      expect(previous, `${name} and ${previous} both map to "${css}"`).toBeUndefined();
      seen.set(css, name);
    }
  });

  it('maps camelCase keys to kebab-case CSS names', () => {
    for (const name of STYLE_PROPERTY_NAMES) {
      const expected = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(cssPropertyName(name), `${name} should map to ${expected}`).toBe(expected);
    }
  });

  it('emits no uppercase in any cssName', () => {
    for (const name of STYLE_PROPERTY_NAMES) {
      expect(cssPropertyName(name)).toBe(cssPropertyName(name).toLowerCase());
    }
  });

  it('declares at least one accepted value kind everywhere', () => {
    for (const name of STYLE_PROPERTY_NAMES) {
      expect(propertyDefinition(name).accepts.length, `${name} accepts nothing`).toBeGreaterThan(0);
    }
  });

  it('only declares keywords on properties that accept keywords', () => {
    for (const name of STYLE_PROPERTY_NAMES) {
      const def = propertyDefinition(name);
      if ('keywords' in def && def.keywords) {
        expect(def.accepts, `${name} lists keywords but does not accept 'keyword'`).toContain(
          'keyword',
        );
      }
    }
  });

  it('has no duplicate keywords within a property', () => {
    for (const name of STYLE_PROPERTY_NAMES) {
      const def = propertyDefinition(name);
      const keywords = 'keywords' in def && def.keywords ? def.keywords : [];
      expect(new Set(keywords).size, `${name} has duplicate keywords`).toBe(keywords.length);
    }
  });
});

describe('isStyleProperty', () => {
  it('accepts catalog members', () => {
    expect(isStyleProperty('fontSize')).toBe(true);
    expect(isStyleProperty('gridTemplateColumns')).toBe(true);
  });

  it('rejects typos, kebab-case, and prototype keys', () => {
    for (const value of [
      'fontSze',
      'font-size',
      '',
      'toString',
      'constructor',
      '__proto__',
      42,
      null,
    ]) {
      expect(isStyleProperty(value), `${String(value)} is not a property`).toBe(false);
    }
  });
});

/**
 * Correct CSS inheritance matters for Phase D: an inherited property resolved
 * without walking ancestors produces a node that renders with the initial value
 * instead of the one it visibly inherits in the browser.
 */
describe('isInherited', () => {
  it('marks text properties as inherited', () => {
    for (const name of ['color', 'fontFamily', 'fontSize', 'lineHeight', 'textAlign'] as const) {
      expect(isInherited(name), `${name} should inherit`).toBe(true);
    }
  });

  it('marks box properties as not inherited', () => {
    for (const name of [
      'marginTop',
      'paddingTop',
      'width',
      'display',
      'backgroundColor',
    ] as const) {
      expect(isInherited(name), `${name} should not inherit`).toBe(false);
    }
  });
});

describe('acceptsValue', () => {
  it('accepts a declared kind', () => {
    expect(acceptsValue('fontSize', px(16))).toBe(true);
    expect(acceptsValue('color', color(hex('#fff')))).toBe(true);
    expect(acceptsValue('opacity', number(0.5))).toBe(true);
    expect(acceptsValue('transitionDuration', ms(200))).toBe(true);
    expect(acceptsValue('backgroundImage', url('/a.png'))).toBe(true);
    expect(acceptsValue('transform', transform([]))).toBe(true);
  });

  it('rejects an undeclared kind', () => {
    expect(acceptsValue('color', px(16))).toBe(false);
    expect(acceptsValue('fontSize', color(hex('#fff')))).toBe(false);
    expect(acceptsValue('opacity', px(1))).toBe(false);
    expect(acceptsValue('zIndex', px(1))).toBe(false);
  });

  it('validates keywords against the property vocabulary', () => {
    expect(acceptsValue('display', keyword('flex'))).toBe(true);
    expect(acceptsValue('display', keyword('flexx'))).toBe(false);
    expect(acceptsValue('position', keyword('sticky'))).toBe(true);
    expect(acceptsValue('position', keyword('centre'))).toBe(false);
  });

  it('allows any keyword where no vocabulary is declared', () => {
    // Font family names are open-ended; enumerating them is impossible.
    expect(acceptsValue('fontFamily', keyword('Inter'))).toBe(true);
    expect(acceptsValue('fontFamily', str('Helvetica Neue'))).toBe(true);
  });

  /**
   * Two deliberate universal exceptions.
   *
   * `token` — a design token stands in for any value; its type is checked where
   * the token is defined. `raw` — the importer's escape hatch; rejecting it would
   * mean silently dropping declarations we failed to model, which would make
   * round-trip import lossy and untrustworthy. `raw` is made safe by
   * sanitisation at serialisation, not by rejection here.
   */
  it('accepts a token for any property', () => {
    for (const name of ['color', 'fontSize', 'display', 'boxShadow', 'zIndex'] as const) {
      expect(acceptsValue(name, token(T('t'))), `${name} should accept a token`).toBe(true);
    }
  });

  it('accepts raw for any property, because import fidelity outranks purity', () => {
    for (const name of ['color', 'fontSize', 'display', 'gridTemplateColumns'] as const) {
      expect(acceptsValue(name, raw('anything')), `${name} should accept raw`).toBe(true);
    }
  });
});

describe('STYLE_PROPERTIES covers the specified style editor', () => {
  it.each([
    [
      'Layout',
      [
        'width',
        'height',
        'minWidth',
        'maxWidth',
        'marginTop',
        'paddingTop',
        'display',
        'position',
        'overflow',
        'zIndex',
      ],
    ],
    ['Flexbox', ['flexDirection', 'flexWrap', 'alignItems', 'justifyContent', 'gap']],
    ['Grid', ['gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gap']],
    [
      'Typography',
      [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'color',
        'textAlign',
        'textDecorationLine',
      ],
    ],
    ['Background', ['backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition']],
    ['Borders', ['borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius']],
    ['Effects', ['boxShadow', 'opacity', 'filter', 'backdropFilter']],
    ['Transforms', ['transform', 'transformOrigin']],
    [
      'Transitions',
      ['transitionProperty', 'transitionDuration', 'transitionTimingFunction', 'transitionDelay'],
    ],
    ['Animations', ['animationName', 'animationDuration', 'animationIterationCount']],
  ])('%s', (_section, properties) => {
    for (const property of properties) {
      expect(Object.hasOwn(STYLE_PROPERTIES, property), `missing ${property}`).toBe(true);
    }
  });
});
