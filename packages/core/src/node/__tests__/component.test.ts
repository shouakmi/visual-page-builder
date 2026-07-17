import { describe, expect, it } from 'vitest';

import type { ComponentId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  BUILTIN_COMPONENTS,
  bodyComponent,
  boxComponent,
  buttonComponent,
  createBuiltinRegistry,
  headingComponent,
  imageComponent,
  sectionComponent,
} from '../builtins.ts';
import type { ComponentDefinition } from '../component.ts';
import {
  EMPTY_REGISTRY,
  allComponents,
  canContain,
  componentsInCategory,
  createRegistry,
  getComponent,
  hasComponent,
  initialProps,
  propDefinition,
  registerComponent,
  unregisterComponent,
  validateProps,
  validateRegistry,
} from '../component.ts';
import { propBoolean, propNumber, propString } from '../props.ts';

const carousel: ComponentDefinition = {
  id: unsafeId('acme:carousel'),
  label: 'Carousel',
  category: 'media',
  tag: 'div',
  children: 'flow',
  props: [{ name: 'loop', label: 'Loop', type: 'boolean', defaultValue: propBoolean(false) }],
};

describe('registry', () => {
  it('starts empty', () => {
    expect(allComponents(EMPTY_REGISTRY)).toEqual([]);
  });

  it('registers and reads back', () => {
    const registry = registerComponent(EMPTY_REGISTRY, carousel);

    expect(getComponent(registry, carousel.id)).toEqual(carousel);
    expect(hasComponent(registry, carousel.id)).toBe(true);
  });

  it('does not mutate the registry it was given', () => {
    const registry = createRegistry([boxComponent]);
    registerComponent(registry, carousel);

    expect(hasComponent(registry, carousel.id)).toBe(false);
  });

  /**
   * The whole point of the registry: a third party adds a component WITHOUT
   * editing this package. The prototype's hardcoded `NodeType` union made this
   * structurally impossible (AUDIT §7.1).
   */
  it('accepts a component the core package has never heard of', () => {
    const registry = registerComponent(createBuiltinRegistry(), carousel);

    expect(getComponent(registry, carousel.id)?.label).toBe('Carousel');
    expect(validateRegistry(registry)).toEqual([]);
  });

  /** Last write wins, so a plugin can re-skin a builtin without a migration. */
  it('lets a later registration override a builtin', () => {
    const override: ComponentDefinition = { ...buttonComponent, label: 'DS Button', tag: 'a' };
    const registry = registerComponent(createBuiltinRegistry(), override);

    expect(getComponent(registry, buttonComponent.id)?.label).toBe('DS Button');
    expect(allComponents(registry)).toHaveLength(BUILTIN_COMPONENTS.length);
  });

  it('unregisters', () => {
    const registry = unregisterComponent(createBuiltinRegistry(), boxComponent.id);
    expect(hasComponent(registry, boxComponent.id)).toBe(false);
  });

  it('ignores unregistering something absent', () => {
    const registry = createBuiltinRegistry();
    expect(unregisterComponent(registry, unsafeId('nope'))).toBe(registry);
  });

  it('groups by category', () => {
    const registry = createBuiltinRegistry();
    const layout = componentsInCategory(registry, 'layout').map((c) => c.id);

    expect(layout).toContain(sectionComponent.id);
    expect(layout).toContain(boxComponent.id);
    expect(layout).not.toContain(headingComponent.id);
  });
});

describe('builtins', () => {
  it('are internally consistent', () => {
    expect(validateRegistry(createBuiltinRegistry())).toEqual([]);
  });

  /**
   * These ids are persisted in every project file. Renaming one orphans every
   * node using it in every project ever saved — this test is the tripwire.
   */
  it('have stable namespaced ids', () => {
    expect(BUILTIN_COMPONENTS.map((c) => c.id)).toEqual([
      'vpb:body',
      'vpb:section',
      'vpb:box',
      'vpb:heading',
      'vpb:text',
      'vpb:image',
      'vpb:link',
      'vpb:button',
    ]);
  });

  it('cover the prototype hardcoded union', () => {
    const tags = BUILTIN_COMPONENTS.map((c) => c.tag);
    expect(tags).toEqual(expect.arrayContaining(['section', 'div', 'p', 'img', 'button']));
  });

  it('lock the body so it cannot be deleted', () => {
    expect(bodyComponent.locked).toBe(true);
  });

  it('model an image source as an asset, not a string', () => {
    expect(propDefinition(imageComponent, 'src')?.type).toBe('asset');
  });

  it('model heading level as a prop so changing it preserves node identity', () => {
    const level = propDefinition(headingComponent, 'level');

    expect(level?.type).toBe('select');
    expect(level?.options?.map((o) => o.value)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  });
});

describe('initialProps', () => {
  it('collects declared defaults', () => {
    expect(initialProps(headingComponent)).toEqual({
      text: propString('Heading'),
      level: propString('h2'),
    });
  });

  it('lets defaultProps override a declared default', () => {
    const custom: ComponentDefinition = {
      ...headingComponent,
      defaultProps: { text: propString('Hello') },
    };

    expect(initialProps(custom).text).toEqual(propString('Hello'));
    expect(initialProps(custom).level).toEqual(propString('h2'));
  });

  it('omits props with no default', () => {
    expect(initialProps(imageComponent)).not.toHaveProperty('src');
  });
});

describe('canContain', () => {
  it('allows flow children', () => {
    expect(canContain(sectionComponent, boxComponent)).toBe(true);
  });

  it('refuses children of a text-only component', () => {
    expect(canContain(headingComponent, boxComponent)).toBe(false);
  });

  it('refuses children of a void component', () => {
    expect(canContain(imageComponent, boxComponent)).toBe(false);
  });

  it('honours allowedChildren', () => {
    const strict: ComponentDefinition = { ...boxComponent, allowedChildren: [imageComponent.id] };

    expect(canContain(strict, imageComponent)).toBe(true);
    expect(canContain(strict, sectionComponent)).toBe(false);
  });

  it('honours allowedParents independently of allowedChildren', () => {
    const picky: ComponentDefinition = { ...imageComponent, allowedParents: [sectionComponent.id] };

    expect(canContain(sectionComponent, picky)).toBe(true);
    expect(canContain(boxComponent, picky)).toBe(false);
  });
});

describe('validateProps', () => {
  it('accepts valid props', () => {
    expect(validateProps(headingComponent, initialProps(headingComponent))).toEqual([]);
  });

  it('rejects a prop the component does not declare', () => {
    const errors = validateProps(boxComponent, { bogus: propString('x') });
    expect(errors.join(' ')).toMatch(/no prop "bogus"/);
  });

  it('rejects a value of the wrong kind', () => {
    const errors = validateProps(headingComponent, { text: propNumber(3) });
    expect(errors.join(' ')).toMatch(/expects multiline, got number/);
  });

  /** A stale file carrying `level: "ghsot"` would fall through every branch. */
  it('rejects a select value outside its options', () => {
    const errors = validateProps(headingComponent, { level: propString('h7') });
    expect(errors.join(' ')).toMatch(/expects select/);
  });

  it('accepts a select value inside its options', () => {
    expect(
      validateProps(headingComponent, { text: propString('Hi'), level: propString('h3') }),
    ).toEqual([]);
  });

  /** A freshly dropped Image has no src yet — report, do not block. */
  it('reports a missing required prop rather than throwing', () => {
    const errors = validateProps(imageComponent, {});
    expect(errors.join(' ')).toMatch(/"src" is required/);
  });
});

describe('validateRegistry', () => {
  it('catches a definition registered under the wrong key', () => {
    const registry = { components: new Map([[unsafeId<ComponentId>('wrong'), carousel]]) };
    expect(validateRegistry(registry).join(' ')).toMatch(/registered under key/);
  });

  it('catches an empty tag', () => {
    const registry = createRegistry([{ ...carousel, tag: '  ' }]);
    expect(validateRegistry(registry).join(' ')).toMatch(/empty tag/);
  });

  it('catches allowedChildren on a component that takes no children', () => {
    const registry = createRegistry([{ ...carousel, children: 'text', allowedChildren: [] }]);
    expect(validateRegistry(registry).join(' ')).toMatch(/does not accept children/);
  });

  it('catches a constraint naming an unregistered component', () => {
    const registry = createRegistry([{ ...carousel, allowedChildren: [unsafeId('ghost')] }]);
    expect(validateRegistry(registry).join(' ')).toMatch(/unknown child/);
  });

  it('catches a duplicated prop name', () => {
    const registry = createRegistry([
      { ...carousel, props: [...carousel.props, ...carousel.props] },
    ]);
    expect(validateRegistry(registry).join(' ')).toMatch(/twice/);
  });

  it('catches a select with no options', () => {
    const registry = createRegistry([
      { ...carousel, props: [{ name: 'mode', label: 'Mode', type: 'select' }] },
    ]);
    expect(validateRegistry(registry).join(' ')).toMatch(/no options/);
  });

  it('catches a default its own type rejects', () => {
    const registry = createRegistry([
      {
        ...carousel,
        props: [{ name: 'loop', label: 'Loop', type: 'boolean', defaultValue: propString('yes') }],
      },
    ]);
    expect(validateRegistry(registry).join(' ')).toMatch(/default that its own type rejects/);
  });
});
