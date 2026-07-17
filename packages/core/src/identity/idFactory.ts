import { customAlphabet } from 'nanoid';

import type {
  AssetId,
  BreakpointId,
  ComponentId,
  NodeId,
  PageId,
  ProjectId,
  StyleRuleId,
  TokenId,
} from './ids.ts';

/**
 * Alphanumeric only — no `-` or `_` from nanoid's default alphabet.
 *
 * Ids end up inside generated CSS identifiers (a node-scoped rule compiles to
 * something like `.n-a7Kd93Bx2Qmz`). Restricting to [0-9A-Za-z] means an id can
 * never introduce a leading `--` (which CSS reserves for custom properties) or a
 * `\` escape, so identifier construction stays a plain concatenation instead of
 * an escaping problem.
 *
 * 12 characters of a 62-symbol alphabet is ~71 bits. At one million ids in a
 * single project the collision probability is on the order of 1e-9 — several
 * orders of magnitude below "a cosmic ray flipped a bit in your RAM", and
 * unlike `Date.now()` it does not collide *by construction* when two nodes are
 * created in the same millisecond.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 12;

const generateId = customAlphabet(ALPHABET, ID_LENGTH);

/**
 * Mints identities.
 *
 * An interface, not a module of free functions, because tests and any future
 * deterministic replay (collaboration, undo audit, golden-file export) need
 * reproducible ids. Everything that creates domain objects takes an `IdFactory`
 * rather than reaching for a global — the same dependency-injection seam used
 * for `ThemeStorage` in @vpb/ui.
 */
export interface IdFactory {
  node(): NodeId;
  page(): PageId;
  project(): ProjectId;
  styleRule(): StyleRuleId;
  breakpoint(): BreakpointId;
  token(): TokenId;
  asset(): AssetId;
  component(): ComponentId;
}

/** Production factory. Cryptographically random, collision-resistant. */
export function createIdFactory(generate: () => string = generateId): IdFactory {
  return {
    node: () => generate() as NodeId,
    page: () => generate() as PageId,
    project: () => generate() as ProjectId,
    styleRule: () => generate() as StyleRuleId,
    breakpoint: () => generate() as BreakpointId,
    token: () => generate() as TokenId,
    asset: () => generate() as AssetId,
    component: () => generate() as ComponentId,
  };
}

/**
 * Sequential, readable, reproducible ids for tests: `node-1`, `node-2`, ...
 *
 * Per-kind counters keep failures legible — `expected node-2, received node-3`
 * localises a bug immediately, where two random 12-char strings tell you only
 * that they differ.
 *
 * NOT for production: predictable ids across sessions would collide the moment
 * two clients created nodes offline and merged.
 */
export function createDeterministicIdFactory(): IdFactory {
  const counters = new Map<string, number>();

  const next = <T extends string>(kind: string): T => {
    const count = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, count);
    return `${kind}-${count}` as T;
  };

  return {
    node: () => next<NodeId>('node'),
    page: () => next<PageId>('page'),
    project: () => next<ProjectId>('project'),
    styleRule: () => next<StyleRuleId>('rule'),
    breakpoint: () => next<BreakpointId>('bp'),
    token: () => next<TokenId>('token'),
    asset: () => next<AssetId>('asset'),
    component: () => next<ComponentId>('component'),
  };
}
