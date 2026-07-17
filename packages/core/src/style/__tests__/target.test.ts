import { describe, expect, it } from 'vitest';

import type { BreakpointId } from '../../identity/ids.ts';
import { unsafeId } from '../../identity/ids.ts';
import {
  PSEUDO_ELEMENTS,
  STYLE_STATES,
  isPseudoElement,
  isStyleState,
  parseTargetKey,
  pseudoSelector,
  stateLayers,
  stateSelector,
  target,
  targetKey,
  targetsEqual,
} from '../target.ts';

const B = (v: string) => unsafeId<BreakpointId>(v);

describe('target', () => {
  it('defaults to the default state and no pseudo', () => {
    expect(target(B('base'))).toEqual({ breakpoint: 'base', state: 'default', pseudo: null });
  });
});

describe('targetKey', () => {
  /**
   * JS Maps key objects by reference, so two structurally identical targets would
   * miss each other. Style panel lookups happen on every selection change, so
   * this needs to be O(1) and correct.
   */
  it('is stable for structurally equal targets', () => {
    expect(targetKey(target(B('base'), 'hover'))).toBe(targetKey(target(B('base'), 'hover')));
  });

  it('distinguishes every axis', () => {
    const keys = new Set([
      targetKey(target(B('base'))),
      targetKey(target(B('mobile'))),
      targetKey(target(B('base'), 'hover')),
      targetKey(target(B('base'), 'default', 'before')),
      targetKey(target(B('base'), 'hover', 'before')),
    ]);
    expect(keys.size).toBe(5);
  });

  it('round-trips through parseTargetKey', () => {
    for (const value of [
      target(B('base')),
      target(B('mobile'), 'hover'),
      target(B('tablet'), 'focusVisible', 'placeholder'),
      target(B('base'), 'default', 'before'),
    ]) {
      expect(parseTargetKey(targetKey(value))).toEqual(value);
    }
  });
});

describe('parseTargetKey', () => {
  it('rejects malformed keys', () => {
    for (const key of [
      '',
      'base',
      'base|default',
      'base|default||extra',
      '|default|',
      'base|nope|',
    ]) {
      expect(parseTargetKey(key), key).toBeNull();
    }
  });

  it('rejects an unknown pseudo-element', () => {
    expect(parseTargetKey('base|default|nope')).toBeNull();
  });
});

describe('targetsEqual', () => {
  it('compares all three axes', () => {
    expect(targetsEqual(target(B('base')), target(B('base')))).toBe(true);
    expect(targetsEqual(target(B('base')), target(B('mobile')))).toBe(false);
    expect(targetsEqual(target(B('base')), target(B('base'), 'hover'))).toBe(false);
    expect(targetsEqual(target(B('base')), target(B('base'), 'default', 'before'))).toBe(false);
  });
});

describe('guards', () => {
  it('accept their vocabularies', () => {
    for (const state of STYLE_STATES) expect(isStyleState(state)).toBe(true);
    for (const pseudo of PSEUDO_ELEMENTS) expect(isPseudoElement(pseudo)).toBe(true);
  });

  it('reject junk', () => {
    for (const value of ['', 'Hover', 'hovered', null, 42, {}]) {
      expect(isStyleState(value)).toBe(false);
      expect(isPseudoElement(value)).toBe(false);
    }
  });
});

describe('stateSelector', () => {
  it('contributes nothing for the default state', () => {
    expect(stateSelector('default')).toBe('');
  });

  it('maps camelCase states to their kebab-case CSS selectors', () => {
    expect(stateSelector('focusVisible')).toBe(':focus-visible');
    expect(stateSelector('hover')).toBe(':hover');
    expect(stateSelector('checked')).toBe(':checked');
  });

  it('produces a valid selector suffix for every state', () => {
    for (const state of STYLE_STATES) {
      const selector = stateSelector(state);
      if (state === 'default') continue;
      expect(selector).toMatch(/^:[a-z-]+$/);
    }
  });
});

describe('pseudoSelector', () => {
  it('uses the double-colon form', () => {
    for (const pseudo of PSEUDO_ELEMENTS) {
      expect(pseudoSelector(pseudo)).toMatch(/^::[a-z-]+$/);
    }
  });

  it('maps camelCase to kebab-case', () => {
    expect(pseudoSelector('firstLine')).toBe('::first-line');
    expect(pseudoSelector('firstLetter')).toBe('::first-letter');
  });
});

describe('stateLayers', () => {
  /**
   * `:hover` layers ON TOP of the base rule rather than replacing it. Without
   * this, every hover style would have to restate the entire resting style, and
   * forgetting one property would blank it on hover.
   */
  it('puts default underneath every non-default state', () => {
    expect(stateLayers('hover')).toEqual(['default', 'hover']);
    expect(stateLayers('active')).toEqual(['default', 'active']);
  });

  it('is just itself for the default state', () => {
    expect(stateLayers('default')).toEqual(['default']);
  });

  /**
   * `:focus-visible` is not `:focus`. Stacking them would leak mouse-focus styles
   * into keyboard-focus styles and break one input mode or the other.
   */
  it('does not stack focusVisible on focus', () => {
    expect(stateLayers('focusVisible')).toEqual(['default', 'focusVisible']);
    expect(stateLayers('focusVisible')).not.toContain('focus');
  });

  it('is ordered weakest-first for every state', () => {
    for (const state of STYLE_STATES) {
      expect(stateLayers(state)[0]).toBe('default');
      expect(stateLayers(state).at(-1)).toBe(state);
    }
  });
});
