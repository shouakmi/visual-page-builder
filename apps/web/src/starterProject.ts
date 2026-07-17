import {
  BASE_BREAKPOINT_ID,
  BOX_COMPONENT_ID,
  HEADING_COMPONENT_ID,
  MOBILE_BREAKPOINT_ID,
  SECTION_COMPONENT_ID,
  TEXT_COMPONENT_ID,
  classScope,
  createBuiltinRegistry,
  createIdFactory,
  createNode,
  createProject,
  getComponent,
  hex,
  insertNode,
  keyword,
  nodeScope,
  color,
  px,
  rem,
  setNodeProp,
  setPageTree,
  setProperty,
  propString,
  target,
  unsafeId,
  updatePageBy,
  type ClassName,
  type ComponentId,
  type IdFactory,
  type Node,
  type NodeId,
  type Project,
  type StyleSheet,
} from '@vpb/core';

/**
 * The page the app opens with.
 *
 * Phase F is what lets the editor open a file; until then it has to start from
 * something, and an empty body would render a blank canvas that demonstrates
 * nothing. This is not a mock: it is a real `Project`, built entirely through
 * core's public API, styled through the real stylesheet, and rendered by the
 * real renderer through the real compiler. Deleting this file and calling
 * `createProject()` would give a valid, empty project.
 *
 * It exists to exercise the parts of the model that are easy to get wrong and
 * invisible when they are: a class shared by two elements, a node-local override
 * that must beat the class, a mobile rule that must beat base, and a hover state.
 * If any of those render wrong, the cascade is wrong, and it is better to see
 * that on screen than to learn it from a golden file.
 */

const CARD = unsafeId<ClassName>('card');

export function starterProject(ids: IdFactory = createIdFactory()): Project {
  const registry = createBuiltinRegistry();

  const make = (component: ComponentId): Node => {
    const definition = getComponent(registry, component);
    if (!definition) throw new Error(`builtin registry is missing ${component}`);
    return createNode(definition, ids);
  };

  let project = createProject('Untitled', ids);
  const page = project.pages[0];
  if (!page) throw new Error('createProject always seeds a page');

  const section = make(SECTION_COMPONENT_ID);
  const heading = setNodeProp(
    make(HEADING_COMPONENT_ID),
    'text',
    propString('Visual Page Builder'),
  );
  const intro = setNodeProp(
    make(TEXT_COMPONENT_ID),
    'text',
    propString('This page is a real project: rendered by the renderer, styled by the compiler.'),
  );

  // Two boxes sharing one class, so the class rule below is visibly reused.
  const cardA = { ...make(BOX_COMPONENT_ID), classes: [CARD] };
  const cardB = { ...make(BOX_COMPONENT_ID), classes: [CARD] };
  const cardAText = setNodeProp(make(TEXT_COMPONENT_ID), 'text', propString('Styled by .card'));
  const cardBText = setNodeProp(
    make(TEXT_COMPONENT_ID),
    'text',
    propString('Same class, node-local override'),
  );

  let tree = page.tree;
  tree = insertNode(tree, section, tree.root);
  tree = insertNode(tree, heading, section.id);
  tree = insertNode(tree, intro, section.id);
  tree = insertNode(tree, cardA, section.id);
  tree = insertNode(tree, cardB, section.id);
  tree = insertNode(tree, cardAText, cardA.id);
  tree = insertNode(tree, cardBText, cardB.id);

  project = updatePageBy(project, page.id, (p) => setPageTree(p, tree));
  return { ...project, styles: starterStyles(project.styles, ids, section.id, cardB.id) };
}

function starterStyles(
  sheet: StyleSheet,
  ids: IdFactory,
  sectionId: NodeId,
  cardBId: NodeId,
): StyleSheet {
  const base = target(BASE_BREAKPOINT_ID);
  const mobile = target(MOBILE_BREAKPOINT_ID);
  const hover = target(BASE_BREAKPOINT_ID, 'hover');

  let styles = sheet;
  const set = (
    scope: Parameters<typeof setProperty>[1],
    at: Parameters<typeof setProperty>[2],
    property: Parameters<typeof setProperty>[3],
    value: Parameters<typeof setProperty>[4],
  ) => {
    styles = setProperty(styles, scope, at, property, value, ids);
  };

  const section = nodeScope(sectionId);
  const cardB = nodeScope(cardBId);

  set(section, base, 'paddingTop', rem(3));
  set(section, base, 'paddingLeft', rem(2));
  set(section, base, 'paddingRight', rem(2));
  set(section, base, 'display', keyword('flex'));
  set(section, base, 'flexDirection', keyword('column'));
  set(section, base, 'gap', rem(1));

  // A class both cards share.
  set(classScope(CARD), base, 'paddingTop', rem(1));
  set(classScope(CARD), base, 'paddingLeft', rem(1));
  set(classScope(CARD), base, 'borderTopLeftRadius', px(8));
  set(classScope(CARD), base, 'backgroundColor', color(hex('#f4f4f5')));

  // State: proves `:hover` layers on the resting style rather than replacing it.
  set(classScope(CARD), hover, 'backgroundColor', color(hex('#e4e4e7')));

  // Breakpoint: the class narrows at mobile.
  set(classScope(CARD), mobile, 'paddingTop', rem(0.5));

  // Node-local, at BASE, on a card that also has `.card`. This must beat the
  // class at EVERY width -- including mobile, where the class has its own rule.
  // If scope-over-breakpoint is ever broken, this is where it shows.
  set(cardB, base, 'backgroundColor', color(hex('#dbeafe')));

  return styles;
}
