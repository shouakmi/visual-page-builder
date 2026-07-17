import type { NodeId } from '../identity/ids.ts';
import type { Breakpoint, BreakpointSet } from './breakpoints.ts';
import { cssOrder, mediaQuery } from './breakpoints.ts';
import { declarationEntries } from './declaration.ts';
import { cssPropertyName } from './properties.ts';
import { classScope, nodeScope, type StyleRule, type StyleScope } from './rule.ts';
import { serializeValue, type SerializeContext } from './serialize.ts';
import { rulesForScope, type StyleSheet } from './stylesheet.ts';
import { pseudoSelector, stateSelector, type StyleTarget } from './target.ts';

/**
 * THE STYLE COMPILER — the model as real CSS.
 *
 * This is the one that matters. AUDIT §4.7 calls unstyled export "the cardinal
 * sin": the prototype had a `renderNodeClean` for export that dropped every
 * style, so the file the customer downloaded did not look like the page they
 * built. WYSIWYG was a claim on the box.
 *
 * The fix is structural rather than diligent. **There is exactly one compiler**,
 * and both the canvas and the exporter call it — so "the editor and the export
 * agree" is not a thing anyone has to maintain, it is a thing that cannot be
 * false. Two compilers agree only until someone edits one of them.
 *
 * ─────────────────── WHY THIS NEEDS NO TRICKS ───────────────────
 *
 * No `@layer`, no `!important`, no specificity hacks, no `:where()`. The model's
 * precedence was built to be the browser's, so reproducing it is a matter of
 * emitting in the right order and letting the cascade do the work:
 *
 *   STATE beats scope — `.btn:hover` is (0,2,0) against `.n-x`'s (0,1,0), so the
 *   browser prefers it on specificity alone, whatever the order.
 *
 *   SCOPE beats breakpoint — a media query adds NO specificity, so `.n-x { }`
 *   emitted after `@media { .btn { } }` wins at every width. Which is exactly
 *   what the resolver says: an explicit element-level value must not evaporate
 *   when you resize.
 *
 *   Within one scope, later BREAKPOINT wins — same specificity, so source order
 *   decides, and `cssOrder` hands them over parents-first.
 *
 * The nesting below is the resolver's loop, written out. If the two ever
 * disagree, one of them has been edited without the other, which is what the
 * golden-file tests are for.
 */

/**
 * The class that carries a node's own rules.
 *
 * `n-` prefixed rather than the bare id because a CSS identifier may not start
 * with a digit and an id can. The alphabet is `[0-9A-Za-z]` by construction (see
 * `createIdFactory`), chosen so this stays a concatenation instead of an
 * escaping problem: an id can never introduce a `--`, a `\`, or a space.
 *
 * A class rather than an `id` selector so node rules sit at (0,1,0) — the same
 * specificity as a class — which is what lets SOURCE ORDER decide between them
 * and keeps scope precedence in the emitter's hands rather than the browser's.
 * `#id` would be (1,0,0) and would silently outrank every class at every
 * breakpoint, making `.btn:hover` lose to a node's resting colour.
 */
export function nodeClassName(id: NodeId): string {
  return `n-${id}`;
}

/** The selector for one rule: `.btn:hover::before`, `.n-a7Kd93Bx2Qmz`. */
export function ruleSelector(scope: StyleScope, target: StyleTarget): string {
  const base = scope.kind === 'class' ? `.${scope.name}` : `.${nodeClassName(scope.nodeId)}`;
  const state = stateSelector(target.state);
  const pseudo = target.pseudo === null ? '' : pseudoSelector(target.pseudo);
  return `${base}${state}${pseudo}`;
}

export interface CompileOptions {
  /** Token resolution. Defaults to "no tokens", which emits fallbacks. */
  readonly serialize?: SerializeContext;
  /**
   * Restrict node-scoped rules to these nodes — the page being compiled.
   *
   * Classes are project-wide and always emitted; node rules are not. Without
   * this, every page's CSS would carry every other page's node rules, which is
   * dead weight in the export and grows with the project. Omit to emit all.
   */
  readonly nodes?: ReadonlySet<NodeId>;
  /** Indent inside a rule body. */
  readonly indent?: string;
}

const DEFAULT_SERIALIZE: SerializeContext = { tokenVar: () => null };

/**
 * The scopes to emit, weakest first.
 *
 * Classes come first, in the sheet's ranking, so a later class beats an earlier
 * one exactly as `scopesFor` says. Node scopes come after every class, so
 * node-local wins — the "scope beats breakpoint" half of the precedence, bought
 * with source order alone.
 *
 * Node scopes are emitted in the sheet's insertion order. They never compete with
 * each other (each selector matches one element), so the order is free; keeping
 * the sheet's makes the output deterministic and diffable rather than shuffling
 * on every build.
 */
function emissionScopes(sheet: StyleSheet, nodes: ReadonlySet<NodeId> | undefined): StyleScope[] {
  const scopes: StyleScope[] = sheet.classOrder.map((name) => classScope(name));

  const seen = new Set<NodeId>();
  for (const rule of sheet.rules.values()) {
    if (rule.scope.kind !== 'node') continue;
    if (seen.has(rule.scope.nodeId)) continue;
    if (nodes && !nodes.has(rule.scope.nodeId)) continue;
    seen.add(rule.scope.nodeId);
    scopes.push(nodeScope(rule.scope.nodeId));
  }

  return scopes;
}

function declarationsToCss(rule: StyleRule, ctx: SerializeContext, indent: string): string {
  return declarationEntries(rule.declarations)
    .map(
      ([property, value]) =>
        `${indent}${cssPropertyName(property)}: ${serializeValue(value, ctx)};`,
    )
    .join('\n');
}

/** Every rule for a scope at one breakpoint, ordered default-state first. */
function rulesAt(sheet: StyleSheet, scope: StyleScope, breakpoint: Breakpoint): StyleRule[] {
  const rules = rulesForScope(sheet, scope).filter(
    (rule) => rule.target.breakpoint === breakpoint.id,
  );

  // Default before the state layers. Specificity already decides between them, so
  // this is for the reader rather than the browser — a stylesheet where `:hover`
  // precedes the resting style reads as a mistake even when it behaves.
  return rules.sort((a, b) => stateRank(a.target) - stateRank(b.target));
}

function stateRank(target: StyleTarget): number {
  return target.state === 'default' ? 0 : 1;
}

/**
 * Compile a stylesheet to CSS text.
 *
 * NOTE FOR PHASE I: do not "optimise" this by merging media blocks. The repeated
 * `@media` per scope looks redundant and is load-bearing — hoisting every mobile
 * rule into one block at the end would move `.btn`'s mobile rule AFTER `.n-x`'s
 * base rule and invert scope-over-breakpoint. Gzip collapses the repetition to
 * almost nothing; the correctness is not recoverable.
 */
export function compileStyleSheet(
  sheet: StyleSheet,
  breakpoints: BreakpointSet,
  options: CompileOptions = {},
): string {
  const ctx = options.serialize ?? DEFAULT_SERIALIZE;
  const indent = options.indent ?? '  ';
  const scopes = emissionScopes(sheet, options.nodes);
  const blocks: string[] = [];

  for (const scope of scopes) {
    for (const breakpoint of cssOrder(breakpoints)) {
      for (const rule of rulesAt(sheet, scope, breakpoint)) {
        const body = declarationsToCss(rule, ctx, indent);
        if (body === '') continue;

        const selector = ruleSelector(rule.scope, rule.target);
        const query = mediaQuery(breakpoint);

        blocks.push(
          query === null
            ? `${selector} {\n${body}\n}`
            : `${query} {\n${indent}${selector} {\n${indentBy(body, indent)}\n${indent}}\n}`,
        );
      }
    }
  }

  return blocks.join('\n\n');
}

function indentBy(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}
