import {
  BOX_COMPONENT_ID,
  BUTTON_COMPONENT_ID,
  EMPTY_ASSET_LIBRARY,
  HEADING_COMPONENT_ID,
  IMAGE_COMPONENT_ID,
  LINK_COMPONENT_ID,
  TEXT_COMPONENT_ID,
  createBuiltinRegistry,
  createDeterministicIdFactory,
  createNode,
  createPage,
  insertNode,
  propAsset,
  propBoolean,
  propString,
  propUrl,
  putAsset,
  setHidden,
  setNodeProp,
  unsafeId,
  updateNode,
  type Asset,
  type AssetId,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeTree,
} from '@vpb/core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RenderChildren, RenderTree } from '../RenderTree.tsx';
import { createBuiltinRenderers, type RenderEnvironment } from '../renderers.tsx';

const registry = createBuiltinRegistry();

function env(assets = EMPTY_ASSET_LIBRARY): RenderEnvironment {
  return { registry, renderers: createBuiltinRenderers(), assets };
}

function definition(id: ComponentId) {
  const found = registry.components.get(id);
  if (!found) throw new Error(`registry is missing ${id}`);
  return found;
}

/** A page tree with a body root, plus a helper to hang nodes off it. */
function editor() {
  const ids = createDeterministicIdFactory();
  const page = createPage('Home', '/', ids);
  return { tree: page.tree, ids };
}

function add(tree: NodeTree, node: Node, parentId = tree.root): NodeTree {
  return insertNode(tree, node, parentId);
}

const make = (
  ids: IdFactory,
  component: ComponentId,
  props: Record<string, ReturnType<typeof propString>> = {},
) => {
  let node = createNode(definition(component), ids);
  for (const [name, value] of Object.entries(props)) node = setNodeProp(node, name, value);
  return node;
};

function renderTree(tree: NodeTree, environment = env()) {
  return render(<RenderTree tree={tree} env={environment} />);
}

describe('structure', () => {
  it('renders the component tag from the definition, not a switch', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const { container } = renderTree(add(tree, box));

    // vpb:box declares tag 'div'.
    expect(container.querySelector('div')).not.toBeNull();
  });

  it('nests children', () => {
    const { tree, ids } = editor();
    const outer = make(ids, BOX_COMPONENT_ID);
    const inner = make(ids, TEXT_COMPONENT_ID, { text: propString('Hi') });

    let next = add(tree, outer);
    next = add(next, inner, outer.id);

    const { container } = renderTree(next);
    expect(container.querySelector(`.n-${outer.id} > .n-${inner.id}`)).not.toBeNull();
  });

  it('renders a subtree when given a starting node', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const next = add(tree, box);

    const { container } = render(<RenderTree tree={next} env={env()} from={box.id} />);
    expect(container.querySelector('body')).toBeNull();
    expect(container.querySelector(`.n-${box.id}`)).not.toBeNull();
  });

  /**
   * THE TRAP THAT FORCES `RenderChildren` TO EXIST — recorded, because it is
   * invisible and it bites silently.
   *
   * The page root is a `vpb:body`, whose tag is literally `body`; correct,
   * because on export that node IS the document's body. But React treats
   * `<body>` as a document singleton: asked to render one, it emits the
   * CHILDREN and drops the element — **and its className with it**. No error,
   * no thrown exception; the node-scoped rules for the page body simply never
   * match anything.
   *
   * So rendering a page through `RenderTree` from the root is quietly wrong. The
   * host must map the root onto the real body instead: `RenderChildren` for the
   * contents, `CanvasFrame`'s `bodyClassName` for the class.
   */
  it('drops the page root element, because React treats body as a singleton', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const { container } = renderTree(add(tree, box));

    expect(container.querySelector('body')).toBeNull();
    // The children survive; the body and its class do not.
    expect(container.querySelector(`.n-${box.id}`)).not.toBeNull();
    expect(container.querySelector(`.n-${tree.root}`)).toBeNull();
  });

  it('renders nothing for a node that is not in the tree', () => {
    const { tree } = editor();
    const { container } = render(<RenderTree tree={tree} env={env()} from={unsafeId('ghost')} />);
    expect(container.innerHTML).toBe('');
  });
});

/**
 * THE COMPILER'S OTHER HALF.
 *
 * `compileStyleSheet` emits node rules as `.n-<id>`. If this class is not on the
 * element, every node-local style silently stops applying — the CSS is correct,
 * the DOM is correct, and the page is wrong. The two halves are asserted against
 * each other rather than trusted to stay in step.
 */
describe('class names', () => {
  it('carries the node class the compiler targets', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const { container } = renderTree(add(tree, box));

    expect(container.querySelector(`.n-${box.id}`)).not.toBeNull();
  });

  it('carries the node class first, then the class references', () => {
    const { tree, ids } = editor();
    let box = make(ids, BOX_COMPONENT_ID);
    box = { ...box, classes: [unsafeId('btn'), unsafeId('btn-primary')] };

    const { container } = renderTree(add(tree, box));
    const element = container.querySelector(`.n-${box.id}`);

    expect(element?.getAttribute('class')).toBe(`n-${box.id} btn btn-primary`);
  });
});

/**
 * THE INTERACTION CONTRACT — the renderer's half of Phase E's hit-testing.
 *
 * Selection, drag and resize all begin with a DOM element and must recover its
 * NodeId. A dedicated `data-vpb-node-id` attribute is that handle, kept off the
 * `n-<id>` styling class so a user class named `n-…` cannot be mistaken for a node
 * class. Stamped centrally in `renderNode`, so this holds for every component —
 * including a plugin's — without the renderer knowing.
 */
describe('hit-test handle', () => {
  it('stamps each element with its NodeId', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const { container } = renderTree(add(tree, box));

    expect(container.querySelector(`.n-${box.id}`)?.getAttribute('data-vpb-node-id')).toBe(box.id);
  });

  it('gives every node in the tree its own handle, so `closest` finds the nearest', () => {
    const { tree, ids } = editor();
    const outer = make(ids, BOX_COMPONENT_ID);
    const inner = make(ids, TEXT_COMPONENT_ID, { text: propString('Hi') });

    let next = add(tree, outer);
    next = add(next, inner, outer.id);

    const { container } = renderTree(next);

    expect(container.querySelector(`[data-vpb-node-id="${outer.id}"]`)).toBe(
      container.querySelector(`.n-${outer.id}`),
    );
    expect(container.querySelector(`[data-vpb-node-id="${inner.id}"]`)).toBe(
      container.querySelector(`.n-${inner.id}`),
    );
  });

  it('stamps a plugin renderer the package has never seen', () => {
    // Central injection: the handle rides on whatever element the renderer returns.
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);

    const custom = new Map(createBuiltinRenderers());
    custom.set(BOX_COMPONENT_ID, ({ className }) => <aside className={className}>plugin</aside>);

    const { container } = renderTree(add(tree, box), { ...env(), renderers: custom });
    expect(container.querySelector('aside')?.getAttribute('data-vpb-node-id')).toBe(box.id);
  });

  it('emits no handle for a hidden node — there is no element to carry one', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const next = updateNode(add(tree, box), setHidden(box, true));

    const { container } = renderTree(next);
    expect(container.querySelector(`[data-vpb-node-id="${box.id}"]`)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* AUDIT §4.5 — "the renderer is an XSS vector"                                */
/* -------------------------------------------------------------------------- */

describe('escaping', () => {
  it('renders a script tag in user text as TEXT, not as a script', () => {
    // The prototype interpolated text into an HTML string, so this executed.
    const { tree, ids } = editor();
    const text = make(ids, TEXT_COMPONENT_ID, {
      text: propString('<script>alert(1)</script>'),
    });

    const { container } = renderTree(add(tree, text));

    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<script>alert(1)</script>');
  });

  it('survives a quote in user text, which used to break the markup', () => {
    const { tree, ids } = editor();
    const text = make(ids, TEXT_COMPONENT_ID, {
      text: propString('He said "hi" & left <b>bold</b>'),
    });

    const { container } = renderTree(add(tree, text));

    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('He said "hi" & left <b>bold</b>');
  });

  it('does not let text escape into an attribute', () => {
    const { tree, ids } = editor();
    const heading = make(ids, HEADING_COMPONENT_ID, {
      text: propString('" onmouseover="alert(1)'),
    });

    const { container } = renderTree(add(tree, heading));
    const element = container.querySelector(`.n-${heading.id}`);

    expect(element?.getAttribute('onmouseover')).toBeNull();
    expect(element?.textContent).toBe('" onmouseover="alert(1)');
  });

  it('refuses a javascript: href — script execution wearing an attribute', () => {
    const { tree, ids } = editor();
    const link = make(ids, LINK_COMPONENT_ID, { href: propUrl('javascript:alert(1)') });

    const { container } = renderTree(add(tree, link));
    expect(container.querySelector('a')?.getAttribute('href')).toBeNull();
  });

  it('allows an ordinary href', () => {
    const { tree, ids } = editor();
    const link = make(ids, LINK_COMPONENT_ID, { href: propUrl('https://example.com/x') });

    const { container } = renderTree(add(tree, link));
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/x');
  });
});

/* -------------------------------------------------------------------------- */
/* AUDIT §4.6 — the iframe was rebuilt on every click                          */
/* -------------------------------------------------------------------------- */

describe('incremental reconciliation', () => {
  /**
   * THE §4.6 FIX, ASSERTED.
   *
   * The prototype ran `doc.open(); doc.write(...); doc.close()` in an effect keyed
   * on state — and `select()` mutated state, so clicking an element rewrote the
   * whole document, losing scroll, focus, form state, and restarting every
   * script. Rendering through React means editing one node touches one node.
   *
   * Asserted on DOM element IDENTITY rather than on markup: markup would be equal
   * either way, and identity is the thing that decides whether the user's caret
   * survives.
   */
  it('re-renders an edited node without rebuilding its siblings', () => {
    const { tree, ids } = editor();
    const stable = make(ids, BOX_COMPONENT_ID);
    const edited = make(ids, TEXT_COMPONENT_ID, { text: propString('before') });

    let next = add(tree, stable);
    next = add(next, edited);

    const { container, rerender } = renderTree(next);
    const stableBefore = container.querySelector(`.n-${stable.id}`);

    const changed = updateNode(next, setNodeProp(edited, 'text', propString('after')));
    rerender(<RenderTree tree={changed} env={env()} />);

    expect(container.querySelector(`.n-${edited.id}`)?.textContent).toBe('after');
    // The very same element object, not an equal one.
    expect(container.querySelector(`.n-${stable.id}`)).toBe(stableBefore);
  });

  it('keeps a node DOM element when a sibling before it is removed', () => {
    // Keys are node ids, so React reparents rather than rebuilds. With
    // index keys this element would be recreated and an in-flight image restart.
    const { tree, ids } = editor();
    const first = make(ids, BOX_COMPONENT_ID);
    const survivor = make(ids, BOX_COMPONENT_ID);

    let next = add(tree, first);
    next = add(next, survivor);

    const { container, rerender } = renderTree(next);
    const before = container.querySelector(`.n-${survivor.id}`);

    const withoutFirst = {
      ...next,
      nodes: new Map([...next.nodes].filter(([id]) => id !== first.id)),
      parents: new Map([...next.parents].filter(([id]) => id !== first.id)),
    };
    const root = withoutFirst.nodes.get(next.root);
    if (!root) throw new Error('unreachable');
    withoutFirst.nodes.set(next.root, { ...root, children: [survivor.id] });

    rerender(<RenderTree tree={withoutFirst} env={env()} />);

    expect(container.querySelector(`.n-${survivor.id}`)).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-component behaviour                                                     */
/* -------------------------------------------------------------------------- */

describe('heading', () => {
  it('overrides the tag from the level prop', () => {
    // Why level is a prop and not six components: changing h2 to h3 must not
    // destroy the node and its id-keyed style rules.
    const { tree, ids } = editor();
    const heading = make(ids, HEADING_COMPONENT_ID, {
      text: propString('Title'),
      level: propString('h1'),
    });

    const { container } = renderTree(add(tree, heading));
    expect(container.querySelector('h1')?.textContent).toBe('Title');
  });

  it('falls back to the definition tag when the level is not one of its options', () => {
    // The value comes from a persisted file. createElement(userString) would
    // otherwise emit whatever tag the file asked for.
    const { tree, ids } = editor();
    const heading = make(ids, HEADING_COMPONENT_ID, {
      text: propString('Title'),
      level: propString('script'),
    });

    const { container } = renderTree(add(tree, heading));
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Title');
  });
});

describe('image', () => {
  const ASSET = unsafeId<AssetId>('asset-1');
  const asset: Asset = {
    id: ASSET,
    name: 'hero.png',
    mimeType: 'image/png',
    byteSize: 100,
    src: 'https://cdn.example.com/hero.png',
    width: 800,
    height: 600,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('resolves the AssetId through the library', () => {
    const { tree, ids } = editor();
    const image = make(ids, IMAGE_COMPONENT_ID, { src: propAsset(ASSET), alt: propString('Hero') });
    const assets = putAsset(EMPTY_ASSET_LIBRARY, asset);

    const { container } = renderTree(add(tree, image), env(assets));
    const element = container.querySelector('img');

    expect(element?.getAttribute('src')).toBe('https://cdn.example.com/hero.png');
    expect(element?.getAttribute('alt')).toBe('Hero');
  });

  it('emits the intrinsic size, so the page does not reflow as the image lands', () => {
    const { tree, ids } = editor();
    const image = make(ids, IMAGE_COMPONENT_ID, { src: propAsset(ASSET) });
    const assets = putAsset(EMPTY_ASSET_LIBRARY, asset);

    const { container } = renderTree(add(tree, image), env(assets));
    expect(container.querySelector('img')?.getAttribute('width')).toBe('800');
    expect(container.querySelector('img')?.getAttribute('height')).toBe('600');
  });

  it('omits src entirely for an unresolved asset rather than emitting an empty one', () => {
    // src="" re-requests the current page in some browsers.
    const { tree, ids } = editor();
    const image = make(ids, IMAGE_COMPONENT_ID, { src: propAsset(ASSET) });

    const { container } = renderTree(add(tree, image));
    expect(container.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  /**
   * An asset's `src` is "interpreted by the host, never by core" and arrives from
   * a persisted file — so it is untrusted for exactly the reason an href is. Every
   * other asset in this suite is an ordinary https URL, which is why this case
   * needs writing down: without it the guard is real and unproven.
   */
  it('refuses an unsafe asset src', () => {
    const { tree, ids } = editor();
    const image = make(ids, IMAGE_COMPONENT_ID, { src: propAsset(ASSET) });
    const assets = putAsset(EMPTY_ASSET_LIBRARY, { ...asset, src: 'javascript:alert(1)' });

    const { container } = renderTree(add(tree, image), env(assets));
    expect(container.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('still emits the intrinsic size when the src is refused', () => {
    // The asset is known; only its location is unusable. Dropping width/height
    // too would reintroduce the reflow for no security gain.
    const { tree, ids } = editor();
    const image = make(ids, IMAGE_COMPONENT_ID, { src: propAsset(ASSET) });
    const assets = putAsset(EMPTY_ASSET_LIBRARY, { ...asset, src: 'javascript:alert(1)' });

    const { container } = renderTree(add(tree, image), env(assets));
    expect(container.querySelector('img')?.getAttribute('width')).toBe('800');
  });

  it('maps lazy to the loading attribute', () => {
    const { tree, ids } = editor();
    const image = make(ids, IMAGE_COMPONENT_ID, {
      src: propAsset(ASSET),
      lazy: propBoolean(true),
    });
    const assets = putAsset(EMPTY_ASSET_LIBRARY, asset);

    const { container } = renderTree(add(tree, image), env(assets));
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });
});

describe('link', () => {
  it('pairs target with rel, so a ticked checkbox cannot ship a tabnabbing hole', () => {
    const { tree, ids } = editor();
    const link = make(ids, LINK_COMPONENT_ID, {
      href: propUrl('https://example.com'),
      newTab: propBoolean(true),
    });

    const { container } = renderTree(add(tree, link));
    const element = container.querySelector('a');

    expect(element?.getAttribute('target')).toBe('_blank');
    expect(element?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('emits neither when newTab is off', () => {
    const { tree, ids } = editor();
    const link = make(ids, LINK_COMPONENT_ID, {
      href: propUrl('https://example.com'),
      newTab: propBoolean(false),
    });

    const { container } = renderTree(add(tree, link));
    expect(container.querySelector('a')?.hasAttribute('target')).toBe(false);
    expect(container.querySelector('a')?.hasAttribute('rel')).toBe(false);
  });
});

describe('button', () => {
  it('emits the type from its prop', () => {
    const { tree, ids } = editor();
    const button = make(ids, BUTTON_COMPONENT_ID, {
      text: propString('Send'),
      type: propString('submit'),
    });

    const { container } = renderTree(add(tree, button));
    expect(container.querySelector('button')?.getAttribute('type')).toBe('submit');
  });

  it('falls back to button for a type outside its options', () => {
    const { tree, ids } = editor();
    const button = make(ids, BUTTON_COMPONENT_ID, {
      text: propString('Send'),
      type: propString('image'),
    });

    const { container } = renderTree(add(tree, button));
    expect(container.querySelector('button')?.getAttribute('type')).toBe('button');
  });
});

/* -------------------------------------------------------------------------- */
/* Visibility and the unknown                                                  */
/* -------------------------------------------------------------------------- */

describe('hidden nodes', () => {
  it('omits a hidden node', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const next = updateNode(add(tree, box), setHidden(box, true));

    const { container } = renderTree(next);
    expect(container.querySelector(`.n-${box.id}`)).toBeNull();
  });

  it('omits a hidden node subtree — children are not visible inside a hidden thing', () => {
    const { tree, ids } = editor();
    const outer = make(ids, BOX_COMPONENT_ID);
    const inner = make(ids, TEXT_COMPONENT_ID, { text: propString('Hi') });

    let next = add(tree, outer);
    next = add(next, inner, outer.id);
    next = updateNode(next, setHidden(outer, true));

    const { container } = renderTree(next);
    expect(container.querySelector(`.n-${inner.id}`)).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('unknown components', () => {
  it('renders nothing rather than crashing the canvas', () => {
    // A project referencing a plugin that is not installed. Inevitable once
    // plugins exist, and the user needs to open the file to find that out.
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const alien: Node = { ...box, component: unsafeId<ComponentId>('acme:carousel') };
    const next = updateNode(add(tree, box), alien);

    expect(() => renderTree(next)).not.toThrow();
    expect(document.body.querySelector('.n-' + box.id)).toBeNull();
  });
});

describe('RenderChildren', () => {
  it('renders the children without the node itself', () => {
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);
    const next = add(tree, box);

    const { container } = render(<RenderChildren tree={next} env={env()} />);

    expect(container.querySelector('body')).toBeNull();
    expect(container.querySelector(`.n-${box.id}`)).not.toBeNull();
  });

  it('renders the children of any node, not just the root', () => {
    const { tree, ids } = editor();
    const outer = make(ids, BOX_COMPONENT_ID);
    const inner = make(ids, TEXT_COMPONENT_ID, { text: propString('Hi') });

    let next = add(tree, outer);
    next = add(next, inner, outer.id);

    const { container } = render(<RenderChildren tree={next} env={env()} of={outer.id} />);

    expect(container.querySelector(`.n-${outer.id}`)).toBeNull();
    expect(container.querySelector(`.n-${inner.id}`)?.textContent).toBe('Hi');
  });

  it('renders nothing for a childless node', () => {
    const { tree } = editor();
    const { container } = render(<RenderChildren tree={tree} env={env()} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('extensibility', () => {
  it('takes a renderer the package has never heard of', () => {
    // AUDIT §7.1: the prototype's hardcoded union made a plugin structurally
    // impossible -- you cannot extend someone else's compile-time union. A Map
    // is extended, not edited.
    const { tree, ids } = editor();
    const box = make(ids, BOX_COMPONENT_ID);

    const custom = new Map(createBuiltinRenderers());
    custom.set(BOX_COMPONENT_ID, ({ className }) => <aside className={className}>plugin</aside>);

    const { container } = renderTree(add(tree, box), { ...env(), renderers: custom });
    expect(container.querySelector('aside')?.textContent).toBe('plugin');
  });
});
