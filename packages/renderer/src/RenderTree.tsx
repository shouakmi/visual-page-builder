import { childrenOf, getComponent, getNode, type NodeId, type NodeTree } from '@vpb/core';
import { Fragment, type ReactElement, type ReactNode } from 'react';

import { classNameFor, defaultRenderer, type RenderEnvironment } from './renderers.tsx';

/**
 * THE TREE WALKER — a node tree as React elements.
 *
 * Two AUDIT findings die here, and both die because this is React rather than a
 * string:
 *
 * §4.5 — the prototype's renderer concatenated HTML, so user text was markup.
 * Elements cannot be escaped out of; there is no grammar to break.
 *
 * §4.6 — "the iframe is destroyed on every state change": `doc.open(); doc.write();
 * doc.close()` in an effect keyed on state, and since `select()` mutated state,
 * *clicking an element rewrote the entire document*. Scroll position, focus, form
 * state and every running script went with it. Rendering through React means a
 * changed node re-renders and the rest of the DOM is untouched, which is what
 * "incremental reconciliation" in the phase brief actually asks for. It is not a
 * feature added on top; it is what happens when you stop calling `doc.write`.
 *
 * Keys are node ids — stable, unique, and independent of position — so moving a
 * node reparents its DOM instead of rebuilding it, and an image mid-download does
 * not restart because a sibling above it was deleted.
 */

export interface RenderTreeProps {
  readonly tree: NodeTree;
  readonly env: RenderEnvironment;
  /** Defaults to the tree's root. Passing one renders a subtree. */
  readonly from?: NodeId;
}

/** Render a tree, or a subtree of it. */
export function RenderTree({ tree, env, from }: RenderTreeProps): ReactElement {
  return <Fragment>{renderNode(tree, from ?? tree.root, env)}</Fragment>;
}

export interface RenderChildrenProps {
  readonly tree: NodeTree;
  readonly env: RenderEnvironment;
  /** Defaults to the root — i.e. the page's body. */
  readonly of?: NodeId;
}

/**
 * Render a node's children WITHOUT the node itself.
 *
 * This exists for one specific, non-obvious, and SILENT reason: **the page root
 * is a `<body>`**. `createPage` roots every tree at a `vpb:body`, whose tag is
 * literally `body` — correct, because on export that node *is* the document's
 * body.
 *
 * React treats `<body>` as a document singleton. Asked to render one, it emits
 * the element's CHILDREN and drops the element — **and its className with it**.
 * Not an exception, not a refusal: `render(<body className="x">hi</body>)` has
 * innerHTML `"hi"`. So `RenderTree` from a page root renders a page whose body
 * rules match nothing, and says nothing about it.
 *
 * The fix is not to give the root some other tag — that would make the canvas
 * disagree with the export, the one thing this phase exists to prevent. It is to
 * recognise that the host's body IS the page's body: render the root's children
 * into it, and put the root's class on it (`CanvasFrame`'s `bodyClassName`).
 * Phase I's exporter does the identical thing with the real document.
 *
 * Found by running the app, not by the suite: every renderer test mounts into a
 * `<div>`, where this is invisible rather than merely wrong.
 */
export function RenderChildren({ tree, env, of }: RenderChildrenProps): ReactElement {
  const parentId = of ?? tree.root;
  return (
    <Fragment>
      {childrenOf(tree, parentId).map((child) => (
        <Fragment key={child.id}>{renderNode(tree, child.id, env)}</Fragment>
      ))}
    </Fragment>
  );
}

/**
 * Render one node and its descendants.
 *
 * Exported because the canvas (and Phase I's exporter, through
 * `renderToStaticMarkup`) want the node itself rather than a wrapper.
 */
export function renderNode(tree: NodeTree, id: NodeId, env: RenderEnvironment): ReactNode {
  const node = getNode(tree, id);
  if (!node) return null;

  /*
   * Hidden means hidden HERE and absent from the export — `node.ts` says so, and
   * the two must agree or the layer panel's eye icon becomes a lie the moment
   * someone downloads the page. Returning null skips the subtree with it: a
   * hidden section's children are not "visible inside a hidden thing".
   */
  if (node.hidden === true) return null;

  const definition = getComponent(env.registry, node.component);
  if (!definition) {
    /*
     * An unknown component is a project referencing a plugin that is not
     * installed — inevitable the moment plugins exist (Phase K), and a normal
     * state rather than a broken one. It must not take the canvas down: the user
     * needs to open the file to find out what is missing. `unknownComponentNodes`
     * is the surface that reports it properly.
     */
    return null;
  }

  // `text` and `none` policies take no child nodes, so their renderer supplies
  // the content from a prop. Walking children for them would be walking an array
  // the model guarantees is empty.
  const children =
    definition.children === 'flow'
      ? childrenOf(tree, id).map((child) => (
          <Fragment key={child.id}>{renderNode(tree, child.id, env)}</Fragment>
        ))
      : null;

  const render = env.renderers.get(node.component) ?? defaultRenderer;

  return render({
    node,
    definition,
    className: classNameFor(node),
    children,
    env,
  });
}
