/* The tree walker — node tree as React elements. */
export { RenderTree, RenderChildren, renderNode } from './RenderTree.tsx';
export type { RenderTreeProps, RenderChildrenProps } from './RenderTree.tsx';

/* The canvas — a sandboxed iframe that cannot run code. */
export { CanvasFrame } from './CanvasFrame.tsx';
export type { CanvasFrameProps } from './CanvasFrame.tsx';

/* The ComponentId -> renderer map. Extended by plugins, never edited by them. */
export { createBuiltinRenderers, defaultRenderer, classNameFor } from './renderers.tsx';
export type {
  NodeRenderer,
  NodeRenderContext,
  RendererMap,
  RenderEnvironment,
} from './renderers.tsx';
