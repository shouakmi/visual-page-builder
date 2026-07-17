import {
  canDropNode,
  childrenOf,
  parentOf,
  type ComponentRegistry,
  type NodeId,
  type NodeTree,
} from '@vpb/core';
import { dropTarget, type Drop, type DropAxis, type DropChild, type Point } from '@vpb/interaction';

/**
 * ⚠️ BROWSER-PENDING — the one part of E2 this repo's tests cannot exercise.
 *
 * Everything above this file is verified: `dropTarget` (geometry), `dragMachine`
 * (lifecycle), `dragController` (store integration). This is the thin adapter that
 * turns a pointer position into the `zone` those consume, and it is made entirely
 * of the three DOM calls jsdom does not implement — `elementFromPoint` returns
 * `null`, `getBoundingClientRect` returns zeros, `getComputedStyle` reports no
 * layout. So it has NO unit test; it must be verified in a real interactive
 * browser, and the drop it produces then flows into the tested controller.
 *
 * Kept deliberately small for that reason: it measures and delegates, and every
 * decision it could get wrong (the index, the validity, the axis meaning) lives in
 * code that is tested. What remains here is "which container, and where are its
 * children on screen" — facts only a laid-out page can answer.
 *
 * v1 reorders among siblings: the zone is the parent of the node under the pointer.
 * Dropping INTO an empty container is a refinement for a later pass.
 */

export interface ResolveDropArgs {
  readonly doc: Document;
  readonly tree: NodeTree;
  readonly registry: ComponentRegistry;
  readonly draggedId: NodeId;
  /**
   * Pointer position in the FRAME's viewport. The drag listeners live on the frame
   * document, so a pointer event already reports frame-relative coordinates — no
   * iframe-offset math, and no need for the iframe element here.
   */
  readonly pointer: Point;
}

export function resolveDrop(args: ResolveDropArgs): Drop | null {
  const { doc, tree, registry, draggedId, pointer } = args;

  const hit = doc.elementFromPoint(pointer.x, pointer.y);
  const handle = hit?.closest('[data-vpb-node-id]');
  const overId = handle?.getAttribute('data-vpb-node-id') as NodeId | null;
  if (!overId) return null;

  // Reorder among the hovered node's siblings.
  const parent = parentOf(tree, overId);
  const parentId = parent?.id ?? tree.root;

  // Core owns validity — cycle, locked, allowed parents. An invalid target
  // resolves to null so the controller clears the preview and the node snaps back.
  if (!canDropNode(tree, registry, draggedId, parentId)) return null;

  const parentElement =
    parentId === tree.root ? doc.body : doc.querySelector(`[data-vpb-node-id="${parentId}"]`);
  if (!parentElement) return null;

  const children: DropChild[] = [];
  for (const child of childrenOf(tree, parentId)) {
    const element = doc.querySelector(`[data-vpb-node-id="${child.id}"]`);
    if (element) children.push({ id: child.id, rect: element.getBoundingClientRect() });
  }

  return dropTarget(pointer, { parentId, children, axis: axisOf(doc, parentElement) });
}

/** Row flex containers lay out horizontally; everything else stacks vertically. */
function axisOf(doc: Document, element: Element): DropAxis {
  const view = doc.defaultView;
  if (!view) return 'vertical';
  const direction = view.getComputedStyle(element).flexDirection;
  return direction === 'row' || direction === 'row-reverse' ? 'horizontal' : 'vertical';
}
