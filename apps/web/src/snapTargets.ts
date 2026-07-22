import { childrenOf, parentOf, type NodeId, type NodeTree } from '@vpb/core';
import { snapCandidates, type Rect, type SnapInput } from '@vpb/interaction';

/**
 * WHAT A RESIZE MAY ALIGN TO — the DOM adapter for snapping.
 *
 * The sibling of `resolveDrop`, and the same division of labour: this only READS
 * the page — where the resized box sits, where its neighbours sit — and hands the
 * numbers to `snapCandidates`, which does the arithmetic. No decision is made
 * here, so the decision stays testable without a browser.
 *
 * Whose lines count:
 *
 * - **The node's siblings**, because alignment is a relationship between things
 *   laid out together. Descendants would let a box snap to its own children, which
 *   moves as you resize — a feedback loop, not a guide.
 * - **The container itself**, because "fill the parent" and "line up with the
 *   column" are the commonest intents of all, and the parent's edges are the only
 *   place they live.
 * - **Never the resized node.** Its own edges are always exactly zero pixels from
 *   itself, so every move would capture instantly and the box could never be
 *   resized at all.
 *
 * Every read here is one jsdom does not lay out (`getBoundingClientRect` is all
 * zeros). `snapTargets.test.ts` stubs them to known rects and asserts the targets
 * derived — so the LOGIC is verified; whether a genuinely laid-out page returns
 * sensible rects is the browser-pending part, as it is for drag.
 */

export interface SnapTargetsArgs {
  readonly doc: Document;
  readonly tree: NodeTree;
  /** The node being resized — excluded from its own candidates. */
  readonly nodeId: NodeId;
}

export function snapTargets(args: SnapTargetsArgs): SnapInput | null {
  const { doc, tree, nodeId } = args;

  const element = elementFor(doc, nodeId);
  if (!element) return null;
  const rect = element.getBoundingClientRect();

  const parentId = parentOf(tree, nodeId)?.id ?? tree.root;

  const rects: Rect[] = [];
  for (const sibling of childrenOf(tree, parentId)) {
    if (sibling.id === nodeId) continue;
    const siblingElement = elementFor(doc, sibling.id);
    if (siblingElement) rects.push(siblingElement.getBoundingClientRect());
  }

  // The page root IS the frame body (it renders no element of its own), exactly as
  // `resolveDrop` and `DropIndicator` already treat it.
  const container = parentId === tree.root ? doc.body : elementFor(doc, parentId);
  if (container) rects.push(container.getBoundingClientRect());

  return {
    // Measured fresh, not captured at grab time: resizing reflows the page, and a
    // box whose own origin has shifted would snap to where its edge used to be.
    boxOrigin: { x: rect.left, y: rect.top },
    candidates: snapCandidates(rects),
  };
}

function elementFor(doc: Document, id: NodeId): Element | null {
  return doc.querySelector(`[data-vpb-node-id="${id}"]`);
}
