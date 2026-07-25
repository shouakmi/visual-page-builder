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
 * FROM A POINTER TO A DROP — the DOM adapter for structural drag.
 *
 * It turns "the pointer is here" into the `{parentId, index}` the tested controller
 * commits. It does no arithmetic of its own — the index is `dropTarget`'s, the
 * validity is core's `canDropNode` — it only READS the page: which element is under
 * the pointer, where the candidate children sit, which way the container stacks.
 *
 * Those reads are the three calls jsdom does not lay out (`elementFromPoint`,
 * `getBoundingClientRect`, `getComputedStyle`). But reading is not computing: a test
 * can hand this function a document whose reads are stubbed to known values and
 * assert the drop it derives — which is exactly what `resolveDrop.test.ts` does. So
 * the LOGIC here is verified. What is not, and cannot be without a real browser, is
 * whether a genuinely laid-out page returns sensible rects in the first place — a
 * smoke test, documented in HANDOFF, not a branch in this file.
 *
 * Two placements: drop INTO the hovered node when it can contain the dragged one (an
 * empty section, a box with room), else reorder among the hovered node's siblings.
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

  // Into the hovered node if it can hold the dragged one; otherwise among its
  // siblings. `canDropNode` answers "can hold" — cycle, locked, allowed parents.
  const into = overId !== draggedId && canDropNode(tree, registry, draggedId, overId);
  const parentId = into ? overId : (parentOf(tree, overId)?.id ?? tree.root);

  // An invalid target resolves to null so the controller clears the preview and the
  // node snaps back rather than showing a drop that would be refused.
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

/**
 * A flex ROW lays out horizontally; block flow and flex COLUMN stack vertically.
 *
 * `flex-direction` alone is not enough: its CSS initial value is `row`, so a plain
 * block container reports `row` while actually stacking its children top to bottom.
 * The axis is horizontal only when the container is genuinely a flex row — display
 * flex AND direction row.
 */
function axisOf(doc: Document, element: Element): DropAxis {
  const view = doc.defaultView;
  if (!view) return 'vertical';
  const style = view.getComputedStyle(element);
  const isFlex = style.display === 'flex' || style.display === 'inline-flex';
  const isRow = style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
  return isFlex && isRow ? 'horizontal' : 'vertical';
}
