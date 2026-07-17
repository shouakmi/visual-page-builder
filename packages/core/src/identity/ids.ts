import type { Brand } from './brand.ts';

/**
 * Every identity in the domain. All are opaque strings at runtime and mutually
 * incompatible at compile time.
 */
export type NodeId = Brand<string, 'NodeId'>;
export type PageId = Brand<string, 'PageId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type StyleRuleId = Brand<string, 'StyleRuleId'>;
export type BreakpointId = Brand<string, 'BreakpointId'>;
export type TokenId = Brand<string, 'TokenId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type ComponentId = Brand<string, 'ComponentId'>;

/**
 * A CSS class name authored in the editor (Webflow's "class"). Branded because
 * a class name is a user-facing string with rules attached — it is not
 * interchangeable with an arbitrary string, and Phase D must escape it before it
 * reaches a stylesheet.
 */
export type ClassName = Brand<string, 'ClassName'>;

/**
 * Reviving an id from JSON, IPC, or an imported file.
 *
 * Deliberately named and deliberately unpleasant to type. Parsing is the one
 * legitimate place a brand must be conjured from a bare string, and making that
 * an explicit, greppable call — rather than a bare `as NodeId` scattered through
 * the codebase — keeps the trust boundary visible. Every call site is a place to
 * ask "has this been validated?".
 */
export function unsafeId<T extends string>(value: string): T {
  return value as T;
}
