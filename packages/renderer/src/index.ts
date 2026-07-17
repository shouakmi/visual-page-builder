/* The tree walker — node tree as React elements. */
export { RenderTree, renderNode } from './RenderTree.tsx';
export type { RenderTreeProps } from './RenderTree.tsx';

/* The ComponentId -> renderer map. Extended by plugins, never edited by them. */
export { createBuiltinRenderers, defaultRenderer, classNameFor } from './renderers.tsx';
export type {
  NodeRenderer,
  NodeRenderContext,
  RendererMap,
  RenderEnvironment,
} from './renderers.tsx';
