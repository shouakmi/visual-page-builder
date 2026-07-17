import {
  BASE_BREAKPOINT_ID,
  HEADING_COMPONENT_ID,
  MOBILE_BREAKPOINT_ID,
  SECTION_COMPONENT_ID,
  color,
  compileStyleSheet,
  createBuiltinRegistry,
  createIdFactory,
  createNode,
  createPage,
  createProject,
  getComponent,
  hex,
  insertNode,
  nodeScope,
  propString,
  rootNode,
  setNodeProp,
  setPageTree,
  setProperty,
  target,
  updatePageBy,
  addPage,
  type ComponentId,
  type Node,
  type NodeId,
  type PageId,
  type Project,
} from '@vpb/core';
import { classNameFor } from '@vpb/renderer';
import { activePage, createEditorStore, setNodePropCommand } from '@vpb/state';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Canvas } from '../Canvas.tsx';

/**
 * D4 — the app wiring.
 *
 * `Canvas.tsx` is the seam where the phases meet: it reads the document from the
 * store, compiles it with the SAME emitter the export will call, renders it
 * through `@vpb/renderer`, and sizes a sandboxed frame to the active device. Each
 * of those pieces is tested in its own package; nothing tested that the wiring
 * connects the right ones. These are those tests, and the `d4-wiring` mutation set
 * is what proves they would fail if the wiring were wrong.
 *
 * The frame renders in an iframe, so this project runs in jsdom (see
 * vitest.config.ts) and reads content out of `frame.contentDocument`, exactly as
 * the renderer's own `CanvasFrame` suite does.
 */

/**
 * A two-page project with known text and one node-local style rule.
 *
 * Built through core's public API rather than reusing `starterProject`, because
 * these tests need handles the starter does not expose: the id of a node to
 * preview an edit on, and a second page to prove the canvas follows the active
 * one.
 */
interface Built {
  readonly project: Project;
  readonly homeId: PageId;
  readonly aboutId: PageId;
  readonly homeHeadingId: NodeId;
}

function makeProject(): Built {
  const ids = createIdFactory();
  const registry = createBuiltinRegistry();
  const make = (component: ComponentId): Node => {
    const definition = getComponent(registry, component);
    if (!definition) throw new Error(`builtin registry is missing ${component}`);
    return createNode(definition, ids);
  };

  let project = createProject('Test', ids);
  const home = project.pages[0];
  if (!home) throw new Error('createProject always seeds a page');

  // home: body > section > heading("HOME HEADING")
  const homeSection = make(SECTION_COMPONENT_ID);
  const homeHeading = setNodeProp(make(HEADING_COMPONENT_ID), 'text', propString('HOME HEADING'));
  let homeTree = home.tree;
  homeTree = insertNode(homeTree, homeSection, homeTree.root);
  homeTree = insertNode(homeTree, homeHeading, homeSection.id);
  project = updatePageBy(project, home.id, (page) => setPageTree(page, homeTree));

  // A NODE-scoped rule on the heading. Node-scoped specifically, so the canvas's
  // per-page node filter is exercised: drop the filter and this rule vanishes.
  project = {
    ...project,
    styles: setProperty(
      project.styles,
      nodeScope(homeHeading.id),
      target(BASE_BREAKPOINT_ID),
      'color',
      color(hex('#ff0000')),
      ids,
    ),
  };

  // A second page with different content, to tell "active page" from "first page".
  const about = createPage('About', '/about', ids);
  const aboutSection = make(SECTION_COMPONENT_ID);
  const aboutHeading = setNodeProp(make(HEADING_COMPONENT_ID), 'text', propString('ABOUT HEADING'));
  let aboutTree = about.tree;
  aboutTree = insertNode(aboutTree, aboutSection, aboutTree.root);
  aboutTree = insertNode(aboutTree, aboutHeading, aboutSection.id);
  project = addPage(project, setPageTree(about, aboutTree));

  return { project, homeId: home.id, aboutId: about.id, homeHeadingId: homeHeading.id };
}

function makeStore(project: Project) {
  return createEditorStore({ project, env: { registry: createBuiltinRegistry() } });
}

/** Render the canvas and hand back the frame element and the document it hosts. */
function mountCanvas(store: ReturnType<typeof createEditorStore>) {
  const result = render(<Canvas store={store} />);
  const frame = result.container.querySelector('iframe');
  if (!frame) throw new Error('the canvas rendered no iframe');
  return { ...result, frame, doc: frame.contentDocument };
}

describe('the canvas is wired to the store', () => {
  it('renders the active page content into the sandboxed frame', () => {
    const { project } = makeProject();
    const { doc } = mountCanvas(makeStore(project));

    expect(doc?.body.textContent).toContain('HOME HEADING');
  });

  /**
   * The one invariant the handoff calls load-bearing. `present`, not `committed`,
   * is what a drag previews — read `committed` and every live drag freezes on the
   * canvas while the store moves underneath it.
   */
  it('reflects `present`, so a live preview shows before it is committed', () => {
    const { project, homeHeadingId } = makeProject();
    const store = makeStore(project);

    // A drag in flight: previewed, deliberately not yet recorded to history.
    store.getState().preview(setNodePropCommand(homeHeadingId, 'text', propString('PREVIEWED')));
    // Guard: the preview must actually have made `present` diverge from
    // `committed`, or this test proves nothing.
    expect(store.getState().present).not.toBe(store.getState().committed);

    const { doc } = mountCanvas(store);

    expect(doc?.body.textContent).toContain('PREVIEWED');
    expect(doc?.body.textContent).not.toContain('HOME HEADING');
  });

  it('renders the ACTIVE page, not merely the first', () => {
    const { project, aboutId } = makeProject();
    const store = makeStore(project);
    store.getState().setActivePage(aboutId);

    const { doc } = mountCanvas(store);

    expect(doc?.body.textContent).toContain('ABOUT HEADING');
    expect(doc?.body.textContent).not.toContain('HOME HEADING');
  });

  /**
   * The page root IS the frame body, so its class has to land on the body element
   * or every rule the user writes on the page targets nothing. See CanvasFrame.
   */
  it('puts the active page root class on the frame body', () => {
    const { project } = makeProject();
    const store = makeStore(project);

    const { doc } = mountCanvas(store);

    const expected = classNameFor(rootNode(activePage(store.getState().present).tree));
    expect(doc?.body.getAttribute('class')).toBe(expected);
  });

  /**
   * The canvas must compile through `compileStyleSheet` — the export's compiler —
   * and inject the result. Recomputing the expected sheet with the same call the
   * canvas makes both proves the CSS reaches the frame AND that the per-page node
   * filter is applied: an empty filter drops the heading's node-scoped rule, and
   * the containment below then fails.
   */
  it('compiles the active page stylesheet into the frame', () => {
    const { project } = makeProject();
    const store = makeStore(project);

    const present = store.getState().present;
    const page = activePage(present);
    const expectedCss = compileStyleSheet(present.project.styles, present.project.breakpoints, {
      nodes: new Set(page.tree.nodes.keys()),
    });
    // The fixture must actually produce a node rule, or the containment is vacuous.
    expect(expectedCss).not.toBe('');

    const { doc } = mountCanvas(store);

    const style = doc?.head.querySelector('style[data-vpb-canvas]');
    expect(style?.textContent).toContain(expectedCss);
  });
});

describe('the frame is sized to the active breakpoint', () => {
  it('is unconstrained at base', () => {
    const { project } = makeProject();
    const { frame } = mountCanvas(makeStore(project));

    // The width wrapper is the iframe's parent.
    expect(frame.parentElement?.style.maxWidth).toBe('');
  });

  it('constrains to the device max-width when a device is active', () => {
    const { project } = makeProject();
    const store = makeStore(project);
    store.getState().setActiveBreakpoint(MOBILE_BREAKPOINT_ID);

    const { frame } = mountCanvas(store);

    // MOBILE_BREAKPOINT_ID's media.maxWidth is 479 (see core/style/breakpoints).
    expect(frame.parentElement?.style.maxWidth).toBe('479px');
  });
});
