import type { BreakpointId } from '../identity/ids.ts';
import { unsafeId } from '../identity/ids.ts';

/**
 * BREAKPOINTS THAT CASCADE.
 *
 * The prototype resolved a node's style as `props.styles?.[breakpoint]` — the
 * EXACT breakpoint, nothing else. Set padding on Desktop, switch to Mobile, and
 * the padding vanished. That is backwards from the CSS cascade and backwards
 * from every competitor: in Webflow, Framer, and Elementor, a narrower
 * breakpoint INHERITS everything from the wider one and overrides only what you
 * change. Anything else means restyling the entire site three times.
 *
 * DESKTOP-FIRST, and deliberately so. `base` carries no media query and applies
 * at every width; narrower breakpoints override it with `max-width`. This is
 * Webflow's model and matches how the specification names things (Desktop first,
 * then Tablet, then Mobile). Tailwind's mobile-first `min-width` convention is
 * equally defensible in the abstract, but it would invert the mental model of
 * every user arriving from a commercial page builder.
 *
 * Cascade is expressed as an explicit `inheritsFrom` edge rather than being
 * inferred from widths. Inference breaks the moment the specification's "custom
 * breakpoints" arrive and someone adds a `min-width: 1440px` tier, where "wider"
 * and "inherits from" point in opposite directions.
 */

export interface MediaCondition {
  readonly minWidth: number | null;
  readonly maxWidth: number | null;
}

export interface Breakpoint {
  readonly id: BreakpointId;
  readonly label: string;
  /** `null` marks the base breakpoint: no media query, applies everywhere. */
  readonly media: MediaCondition | null;
  /** Cascade parent. `null` only for base. */
  readonly inheritsFrom: BreakpointId | null;
}

export interface BreakpointSet {
  readonly breakpoints: readonly Breakpoint[];
}

/**
 * Stable, well-known ids for the default set.
 *
 * NOT generated. These are persisted inside every project file and every style
 * rule; a generated id would differ per project and make a rule authored in one
 * project meaningless in another — breaking copy/paste between projects,
 * templates, and any shared component library.
 */
export const BASE_BREAKPOINT_ID = unsafeId<BreakpointId>('base');
export const TABLET_BREAKPOINT_ID = unsafeId<BreakpointId>('tablet');
export const MOBILE_LANDSCAPE_BREAKPOINT_ID = unsafeId<BreakpointId>('mobile-landscape');
export const MOBILE_BREAKPOINT_ID = unsafeId<BreakpointId>('mobile');

/**
 * The default ladder, matching the widths commercial builders converged on.
 * A superset of the specification's Desktop/Tablet/Mobile: mobile landscape
 * exists because 767 -> 479 is where most real layouts actually break.
 */
export function defaultBreakpoints(): BreakpointSet {
  return {
    breakpoints: [
      { id: BASE_BREAKPOINT_ID, label: 'Desktop', media: null, inheritsFrom: null },
      {
        id: TABLET_BREAKPOINT_ID,
        label: 'Tablet',
        media: { minWidth: null, maxWidth: 991 },
        inheritsFrom: BASE_BREAKPOINT_ID,
      },
      {
        id: MOBILE_LANDSCAPE_BREAKPOINT_ID,
        label: 'Mobile landscape',
        media: { minWidth: null, maxWidth: 767 },
        inheritsFrom: TABLET_BREAKPOINT_ID,
      },
      {
        id: MOBILE_BREAKPOINT_ID,
        label: 'Mobile',
        media: { minWidth: null, maxWidth: 479 },
        inheritsFrom: MOBILE_LANDSCAPE_BREAKPOINT_ID,
      },
    ],
  };
}

export function getBreakpoint(set: BreakpointSet, id: BreakpointId): Breakpoint | undefined {
  return set.breakpoints.find((bp) => bp.id === id);
}

export function baseBreakpoint(set: BreakpointSet): Breakpoint {
  const base = set.breakpoints.find((bp) => bp.inheritsFrom === null);
  // createBreakpointSet guarantees exactly one; this is a defensive assertion,
  // not a code path any valid set can reach.
  if (!base) throw new Error('Breakpoint set has no base breakpoint.');
  return base;
}

/**
 * Every reason a breakpoint set is invalid, as human-readable strings.
 *
 * Returns a list rather than throwing on the first problem: this feeds a
 * settings UI where a user editing custom breakpoints deserves to see all their
 * mistakes at once, not one per save.
 */
export function validateBreakpointSet(breakpoints: readonly Breakpoint[]): readonly string[] {
  const errors: string[] = [];

  if (breakpoints.length === 0)
    return ['A breakpoint set must contain at least a base breakpoint.'];

  const ids = new Set<BreakpointId>();
  for (const bp of breakpoints) {
    if (ids.has(bp.id)) errors.push(`Duplicate breakpoint id "${bp.id}".`);
    ids.add(bp.id);
    if (bp.label.trim() === '') errors.push(`Breakpoint "${bp.id}" has an empty label.`);
  }

  const bases = breakpoints.filter((bp) => bp.inheritsFrom === null);
  if (bases.length === 0) {
    errors.push('No base breakpoint: exactly one breakpoint must have inheritsFrom: null.');
  } else if (bases.length > 1) {
    errors.push(`Multiple base breakpoints (${bases.map((b) => b.id).join(', ')}); expected one.`);
  }

  for (const bp of breakpoints) {
    if (bp.inheritsFrom === null) {
      if (bp.media !== null) {
        errors.push(`Base breakpoint "${bp.id}" must not have a media condition.`);
      }
      continue;
    }

    if (!ids.has(bp.inheritsFrom)) {
      errors.push(`Breakpoint "${bp.id}" inherits from unknown "${bp.inheritsFrom}".`);
    }

    /**
     * A non-base breakpoint with no media query would match at every width and be
     * indistinguishable from its parent — a second base wearing a disguise.
     */
    if (bp.media === null) {
      errors.push(`Breakpoint "${bp.id}" must have a media condition (only base may omit one).`);
      continue;
    }

    const { minWidth, maxWidth } = bp.media;
    if (minWidth === null && maxWidth === null) {
      errors.push(`Breakpoint "${bp.id}" has an empty media condition.`);
    }
    if (minWidth !== null && (!Number.isFinite(minWidth) || minWidth < 0)) {
      errors.push(`Breakpoint "${bp.id}" has an invalid minWidth.`);
    }
    if (maxWidth !== null && (!Number.isFinite(maxWidth) || maxWidth < 0)) {
      errors.push(`Breakpoint "${bp.id}" has an invalid maxWidth.`);
    }
    if (minWidth !== null && maxWidth !== null && minWidth > maxWidth) {
      errors.push(`Breakpoint "${bp.id}" has minWidth greater than maxWidth.`);
    }
  }

  /**
   * Cycle detection. A cycle makes `cascadeChain` non-terminating, and custom
   * breakpoints are user-editable — someone WILL point two at each other.
   */
  const byId = new Map(breakpoints.map((bp) => [bp.id, bp]));
  for (const bp of breakpoints) {
    const seen = new Set<BreakpointId>([bp.id]);
    let cursor = bp.inheritsFrom;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        errors.push(`Breakpoint inheritance cycle involving "${bp.id}".`);
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.inheritsFrom ?? null;
    }
  }

  return errors;
}

/** Validates, then constructs. Throws with every problem listed at once. */
export function createBreakpointSet(breakpoints: readonly Breakpoint[]): BreakpointSet {
  const errors = validateBreakpointSet(breakpoints);
  if (errors.length > 0) {
    throw new Error(`Invalid breakpoint set:\n- ${errors.join('\n- ')}`);
  }
  return { breakpoints };
}

/**
 * The inheritance chain from base down to `id`, inclusive, base first.
 *
 * This IS the cascade. Resolving a style at Mobile walks
 * [Desktop, Tablet, Mobile landscape, Mobile] and merges in that order, so
 * everything set on Desktop survives to Mobile unless Mobile overrides it.
 */
export function cascadeChain(set: BreakpointSet, id: BreakpointId): readonly Breakpoint[] {
  const byId = new Map(set.breakpoints.map((bp) => [bp.id, bp]));
  const chain: Breakpoint[] = [];
  const seen = new Set<BreakpointId>();

  let cursor: BreakpointId | null = id;
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new Error(`Breakpoint inheritance cycle at "${cursor}".`);
    }
    seen.add(cursor);

    const bp: Breakpoint | undefined = byId.get(cursor);
    if (!bp) {
      // An unknown id resolves to whatever chain we found, rather than throwing:
      // a rule referencing a breakpoint the user deleted should degrade, not
      // crash the editor. The orphan rule is reported by `orphanedRules`.
      break;
    }
    chain.push(bp);
    cursor = bp.inheritsFrom;
  }

  return chain.reverse();
}

/**
 * Emission order for CSS: a topological order, parents before children.
 *
 * Media queries add NO specificity, so which breakpoint wins at a given width is
 * decided purely by source order. Emitting parents first means a child's rules
 * come later and win wherever both queries match — which is exactly what
 * `cascadeChain` says should happen. The stylesheet and the resolver agree
 * because they are two readings of the same edge list.
 *
 * Siblings keep their declaration order, so output is deterministic and diffable.
 */
export function cssOrder(set: BreakpointSet): readonly Breakpoint[] {
  const children = new Map<BreakpointId | null, Breakpoint[]>();
  for (const bp of set.breakpoints) {
    const siblings = children.get(bp.inheritsFrom) ?? [];
    siblings.push(bp);
    children.set(bp.inheritsFrom, siblings);
  }

  const ordered: Breakpoint[] = [];
  const visit = (parent: BreakpointId | null): void => {
    for (const bp of children.get(parent) ?? []) {
      ordered.push(bp);
      visit(bp.id);
    }
  };
  visit(null);

  return ordered;
}

/** `@media (max-width: 991px)`. Returns null for base, which needs no wrapper. */
export function mediaQuery(breakpoint: Breakpoint): string | null {
  if (!breakpoint.media) return null;

  const conditions: string[] = [];
  if (breakpoint.media.minWidth !== null) {
    conditions.push(`(min-width: ${breakpoint.media.minWidth}px)`);
  }
  if (breakpoint.media.maxWidth !== null) {
    conditions.push(`(max-width: ${breakpoint.media.maxWidth}px)`);
  }
  return conditions.length > 0 ? `@media ${conditions.join(' and ')}` : null;
}
