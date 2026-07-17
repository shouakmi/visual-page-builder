import type { BreakpointId } from '../identity/ids.ts';
import { unsafeId } from '../identity/ids.ts';

/**
 * WHAT a declaration block applies to: a point in (breakpoint x state x pseudo).
 *
 * These three axes are the whole reason the prototype's style-as-string could
 * not work. A string has exactly one slot; a real page needs
 * `.btn` and `.btn:hover` and `@media(max-width:479px){.btn}` and
 * `.btn::before` to hold different declarations simultaneously.
 */

/**
 * Interaction states the editor can author and preview.
 *
 * `focusVisible` is listed alongside `focus` rather than replacing it: they are
 * genuinely different selectors (`:focus-visible` only matches when the browser
 * decides a focus ring is warranted — keyboard, not mouse), and a builder that
 * silently rewrote one to the other would break either mouse or keyboard users.
 */
export const STYLE_STATES = [
  'default',
  'hover',
  'focus',
  'focusVisible',
  'active',
  'disabled',
  'visited',
  'checked',
] as const;

export type StyleState = (typeof STYLE_STATES)[number];

export const PSEUDO_ELEMENTS = [
  'before',
  'after',
  'placeholder',
  'selection',
  'marker',
  'firstLine',
  'firstLetter',
] as const;

export type PseudoElement = (typeof PSEUDO_ELEMENTS)[number];

export interface StyleTarget {
  readonly breakpoint: BreakpointId;
  readonly state: StyleState;
  /** `null` = the element itself, not one of its generated boxes. */
  readonly pseudo: PseudoElement | null;
}

export function target(
  breakpoint: BreakpointId,
  state: StyleState = 'default',
  pseudo: PseudoElement | null = null,
): StyleTarget {
  return { breakpoint, state, pseudo };
}

export function isStyleState(value: unknown): value is StyleState {
  return typeof value === 'string' && (STYLE_STATES as readonly string[]).includes(value);
}

export function isPseudoElement(value: unknown): value is PseudoElement {
  return typeof value === 'string' && (PSEUDO_ELEMENTS as readonly string[]).includes(value);
}

const KEY_SEPARATOR = '|';

/**
 * A stable string key for map lookup.
 *
 * Targets are compound values used as Map keys on the hot path (the style panel
 * asks "the rule for .btn at mobile:hover" on every selection change). JS Maps
 * key by reference for objects, so two structurally identical targets would miss
 * each other. A string key makes lookup O(1) and correct.
 */
export function targetKey(value: StyleTarget): string {
  return [value.breakpoint, value.state, value.pseudo ?? ''].join(KEY_SEPARATOR);
}

/** Inverse of `targetKey`. Returns null on anything malformed. */
export function parseTargetKey(key: string): StyleTarget | null {
  const parts = key.split(KEY_SEPARATOR);
  if (parts.length !== 3) return null;

  const [breakpoint, state, pseudo] = parts;
  if (!breakpoint || breakpoint === '') return null;
  if (!isStyleState(state)) return null;
  if (pseudo !== '' && !isPseudoElement(pseudo)) return null;

  return {
    breakpoint: unsafeId<BreakpointId>(breakpoint),
    state,
    pseudo: pseudo === '' ? null : (pseudo as PseudoElement),
  };
}

export function targetsEqual(a: StyleTarget, b: StyleTarget): boolean {
  return a.breakpoint === b.breakpoint && a.state === b.state && a.pseudo === b.pseudo;
}

/** The CSS selector suffix for a state. `default` contributes nothing. */
export function stateSelector(state: StyleState): string {
  switch (state) {
    case 'default':
      return '';
    case 'hover':
      return ':hover';
    case 'focus':
      return ':focus';
    case 'focusVisible':
      return ':focus-visible';
    case 'active':
      return ':active';
    case 'disabled':
      return ':disabled';
    case 'visited':
      return ':visited';
    case 'checked':
      return ':checked';
  }
}

/** The CSS selector suffix for a pseudo-element. */
export function pseudoSelector(pseudo: PseudoElement): string {
  switch (pseudo) {
    case 'before':
      return '::before';
    case 'after':
      return '::after';
    case 'placeholder':
      return '::placeholder';
    case 'selection':
      return '::selection';
    case 'marker':
      return '::marker';
    case 'firstLine':
      return '::first-line';
    case 'firstLetter':
      return '::first-letter';
  }
}

/**
 * The state layers that contribute to rendering `state`, weakest first.
 *
 * `:hover` in CSS does not REPLACE the base rule, it layers on top of it — an
 * element with `color: blue` and `:hover { font-weight: bold }` is blue AND bold
 * while hovered. Resolving a hover target therefore has to merge the default
 * declarations underneath the hover ones, or every hover style would have to
 * redundantly restate the entire base style.
 *
 * Deliberately NOT transitive beyond one step: `focusVisible` does not layer on
 * `focus`. They are independent selectors, and stacking them would silently make
 * mouse-focus styles leak into keyboard-focus styles.
 */
export function stateLayers(state: StyleState): readonly StyleState[] {
  return state === 'default' ? ['default'] : ['default', state];
}
