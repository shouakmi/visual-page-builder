import type { StyleValue, StyleValueKind } from './values.ts';

/**
 * THE PROPERTY CATALOG.
 *
 * Every CSS property the visual editor understands, with the metadata needed to
 * edit, validate, and emit it.
 *
 * This is DATA, not code, and that is the point. Three things fall out of it for
 * free:
 *
 *  1. `StyleProperty` — a real union type, derived from the keys. A typo in a
 *     property name is a compile error. The prototype's `Record<string, any>`
 *     could not tell `fontSize` from `fontSze`.
 *
 *  2. The Phase H style panel is GENERATED, not hand-written. `accepts` picks the
 *     control (colour picker vs unit input vs dropdown), `keywords` populates the
 *     dropdown, `group` decides the section. Ninety hand-built form controls is
 *     how a style panel drifts out of sync with its own model.
 *
 *  3. `inherited` gives Phase D correct cascade semantics through the node tree.
 *
 * Coverage maps to the specification's Style Editor: Layout, Flexbox, Grid,
 * Typography, Background, Borders, Effects, Transforms, Transitions, Animations.
 */

export type PropertyGroup =
  | 'layout'
  | 'flex'
  | 'grid'
  | 'typography'
  | 'background'
  | 'border'
  | 'effects'
  | 'transform'
  | 'transition'
  | 'animation'
  | 'interactivity';

export interface PropertyDefinition {
  /** kebab-case name for CSS output. */
  readonly cssName: string;
  readonly group: PropertyGroup;
  /**
   * Value kinds this property accepts. `token` is implicitly allowed everywhere
   * — a design token can stand in for any value — so it is omitted here and
   * handled by `acceptsValue`. Likewise `raw`, which is the importer's escape
   * hatch and must never be rejected or import becomes lossy.
   */
  readonly accepts: readonly StyleValueKind[];
  /** Legal keywords. Drives dropdowns; validated by `acceptsValue`. */
  readonly keywords?: readonly string[];
  /**
   * CSS inheritance semantics. `color` inherits to descendants; `margin` does
   * not. Phase D needs this to resolve a node's effective style through its
   * ancestors rather than guessing.
   */
  readonly inherited: boolean;
}

const SIZE_KEYWORDS = ['auto', 'min-content', 'max-content', 'fit-content'] as const;
const OVERFLOW_KEYWORDS = ['visible', 'hidden', 'scroll', 'auto', 'clip'] as const;
const LINE_STYLE_KEYWORDS = [
  'none',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
] as const;
const ALIGN_KEYWORDS = [
  'stretch',
  'flex-start',
  'flex-end',
  'center',
  'baseline',
  'start',
  'end',
] as const;
const JUSTIFY_KEYWORDS = [
  'flex-start',
  'flex-end',
  'center',
  'space-between',
  'space-around',
  'space-evenly',
  'start',
  'end',
] as const;
const EASING_KEYWORDS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
] as const;

export const STYLE_PROPERTIES = {
  /* ------------------------------- Layout -------------------------------- */
  display: {
    cssName: 'display',
    group: 'layout',
    accepts: ['keyword'],
    keywords: [
      'block',
      'inline',
      'inline-block',
      'flex',
      'inline-flex',
      'grid',
      'inline-grid',
      'contents',
      'none',
    ],
    inherited: false,
  },
  position: {
    cssName: 'position',
    group: 'layout',
    accepts: ['keyword'],
    keywords: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    inherited: false,
  },
  top: {
    cssName: 'top',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  right: {
    cssName: 'right',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  bottom: {
    cssName: 'bottom',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  left: {
    cssName: 'left',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },

  width: {
    cssName: 'width',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: SIZE_KEYWORDS,
    inherited: false,
  },
  height: {
    cssName: 'height',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: SIZE_KEYWORDS,
    inherited: false,
  },
  minWidth: {
    cssName: 'min-width',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: SIZE_KEYWORDS,
    inherited: false,
  },
  minHeight: {
    cssName: 'min-height',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: SIZE_KEYWORDS,
    inherited: false,
  },
  maxWidth: {
    cssName: 'max-width',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['none', ...SIZE_KEYWORDS],
    inherited: false,
  },
  maxHeight: {
    cssName: 'max-height',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['none', ...SIZE_KEYWORDS],
    inherited: false,
  },

  marginTop: {
    cssName: 'margin-top',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  marginRight: {
    cssName: 'margin-right',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  marginBottom: {
    cssName: 'margin-bottom',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  marginLeft: {
    cssName: 'margin-left',
    group: 'layout',
    accepts: ['length', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },

  paddingTop: { cssName: 'padding-top', group: 'layout', accepts: ['length'], inherited: false },
  paddingRight: {
    cssName: 'padding-right',
    group: 'layout',
    accepts: ['length'],
    inherited: false,
  },
  paddingBottom: {
    cssName: 'padding-bottom',
    group: 'layout',
    accepts: ['length'],
    inherited: false,
  },
  paddingLeft: { cssName: 'padding-left', group: 'layout', accepts: ['length'], inherited: false },

  overflow: {
    cssName: 'overflow',
    group: 'layout',
    accepts: ['keyword'],
    keywords: OVERFLOW_KEYWORDS,
    inherited: false,
  },
  overflowX: {
    cssName: 'overflow-x',
    group: 'layout',
    accepts: ['keyword'],
    keywords: OVERFLOW_KEYWORDS,
    inherited: false,
  },
  overflowY: {
    cssName: 'overflow-y',
    group: 'layout',
    accepts: ['keyword'],
    keywords: OVERFLOW_KEYWORDS,
    inherited: false,
  },

  zIndex: {
    cssName: 'z-index',
    group: 'layout',
    accepts: ['number', 'keyword'],
    keywords: ['auto'],
    inherited: false,
  },
  boxSizing: {
    cssName: 'box-sizing',
    group: 'layout',
    accepts: ['keyword'],
    keywords: ['content-box', 'border-box'],
    inherited: false,
  },
  aspectRatio: {
    cssName: 'aspect-ratio',
    group: 'layout',
    accepts: ['number', 'keyword', 'raw'],
    keywords: ['auto'],
    inherited: false,
  },

  /* -------------------------------- Flex --------------------------------- */
  flexDirection: {
    cssName: 'flex-direction',
    group: 'flex',
    accepts: ['keyword'],
    keywords: ['row', 'row-reverse', 'column', 'column-reverse'],
    inherited: false,
  },
  flexWrap: {
    cssName: 'flex-wrap',
    group: 'flex',
    accepts: ['keyword'],
    keywords: ['nowrap', 'wrap', 'wrap-reverse'],
    inherited: false,
  },
  justifyContent: {
    cssName: 'justify-content',
    group: 'flex',
    accepts: ['keyword'],
    keywords: JUSTIFY_KEYWORDS,
    inherited: false,
  },
  alignItems: {
    cssName: 'align-items',
    group: 'flex',
    accepts: ['keyword'],
    keywords: ALIGN_KEYWORDS,
    inherited: false,
  },
  alignContent: {
    cssName: 'align-content',
    group: 'flex',
    accepts: ['keyword'],
    keywords: [...JUSTIFY_KEYWORDS, 'stretch'],
    inherited: false,
  },
  alignSelf: {
    cssName: 'align-self',
    group: 'flex',
    accepts: ['keyword'],
    keywords: ['auto', ...ALIGN_KEYWORDS],
    inherited: false,
  },
  gap: { cssName: 'gap', group: 'flex', accepts: ['length'], inherited: false },
  rowGap: { cssName: 'row-gap', group: 'flex', accepts: ['length'], inherited: false },
  columnGap: { cssName: 'column-gap', group: 'flex', accepts: ['length'], inherited: false },
  flexGrow: { cssName: 'flex-grow', group: 'flex', accepts: ['number'], inherited: false },
  flexShrink: { cssName: 'flex-shrink', group: 'flex', accepts: ['number'], inherited: false },
  flexBasis: {
    cssName: 'flex-basis',
    group: 'flex',
    accepts: ['length', 'keyword'],
    keywords: ['auto', 'content'],
    inherited: false,
  },
  order: { cssName: 'order', group: 'flex', accepts: ['number'], inherited: false },

  /* -------------------------------- Grid --------------------------------- */
  gridTemplateColumns: {
    cssName: 'grid-template-columns',
    group: 'grid',
    accepts: ['keyword', 'length', 'list', 'raw'],
    keywords: ['none'],
    inherited: false,
  },
  gridTemplateRows: {
    cssName: 'grid-template-rows',
    group: 'grid',
    accepts: ['keyword', 'length', 'list', 'raw'],
    keywords: ['none'],
    inherited: false,
  },
  gridTemplateAreas: {
    cssName: 'grid-template-areas',
    group: 'grid',
    accepts: ['keyword', 'string', 'list'],
    keywords: ['none'],
    inherited: false,
  },
  gridAutoFlow: {
    cssName: 'grid-auto-flow',
    group: 'grid',
    accepts: ['keyword'],
    keywords: ['row', 'column', 'dense', 'row dense', 'column dense'],
    inherited: false,
  },
  gridAutoColumns: {
    cssName: 'grid-auto-columns',
    group: 'grid',
    accepts: ['length', 'keyword', 'raw'],
    keywords: SIZE_KEYWORDS,
    inherited: false,
  },
  gridAutoRows: {
    cssName: 'grid-auto-rows',
    group: 'grid',
    accepts: ['length', 'keyword', 'raw'],
    keywords: SIZE_KEYWORDS,
    inherited: false,
  },
  gridColumn: {
    cssName: 'grid-column',
    group: 'grid',
    accepts: ['keyword', 'number', 'raw'],
    keywords: ['auto'],
    inherited: false,
  },
  gridRow: {
    cssName: 'grid-row',
    group: 'grid',
    accepts: ['keyword', 'number', 'raw'],
    keywords: ['auto'],
    inherited: false,
  },
  gridArea: {
    cssName: 'grid-area',
    group: 'grid',
    accepts: ['keyword', 'string', 'raw'],
    keywords: ['auto'],
    inherited: false,
  },
  justifyItems: {
    cssName: 'justify-items',
    group: 'grid',
    accepts: ['keyword'],
    keywords: ALIGN_KEYWORDS,
    inherited: false,
  },
  justifySelf: {
    cssName: 'justify-self',
    group: 'grid',
    accepts: ['keyword'],
    keywords: ['auto', ...ALIGN_KEYWORDS],
    inherited: false,
  },
  placeItems: {
    cssName: 'place-items',
    group: 'grid',
    accepts: ['keyword', 'raw'],
    keywords: ALIGN_KEYWORDS,
    inherited: false,
  },

  /* ----------------------------- Typography ------------------------------ */
  fontFamily: {
    cssName: 'font-family',
    group: 'typography',
    accepts: ['string', 'keyword', 'list'],
    inherited: true,
  },
  fontSize: { cssName: 'font-size', group: 'typography', accepts: ['length'], inherited: true },
  fontWeight: {
    cssName: 'font-weight',
    group: 'typography',
    accepts: ['number', 'keyword'],
    keywords: ['normal', 'bold', 'lighter', 'bolder'],
    inherited: true,
  },
  fontStyle: {
    cssName: 'font-style',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['normal', 'italic', 'oblique'],
    inherited: true,
  },
  lineHeight: {
    cssName: 'line-height',
    group: 'typography',
    accepts: ['number', 'length', 'keyword'],
    keywords: ['normal'],
    inherited: true,
  },
  letterSpacing: {
    cssName: 'letter-spacing',
    group: 'typography',
    accepts: ['length', 'keyword'],
    keywords: ['normal'],
    inherited: true,
  },
  textAlign: {
    cssName: 'text-align',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['left', 'right', 'center', 'justify', 'start', 'end'],
    inherited: true,
  },
  textDecorationLine: {
    cssName: 'text-decoration-line',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['none', 'underline', 'overline', 'line-through'],
    inherited: false,
  },
  textDecorationColor: {
    cssName: 'text-decoration-color',
    group: 'typography',
    accepts: ['color'],
    inherited: false,
  },
  textDecorationStyle: {
    cssName: 'text-decoration-style',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['solid', 'double', 'dotted', 'dashed', 'wavy'],
    inherited: false,
  },
  textTransform: {
    cssName: 'text-transform',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['none', 'uppercase', 'lowercase', 'capitalize'],
    inherited: true,
  },
  textOverflow: {
    cssName: 'text-overflow',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['clip', 'ellipsis'],
    inherited: false,
  },
  textShadow: {
    cssName: 'text-shadow',
    group: 'typography',
    accepts: ['shadow', 'list', 'keyword'],
    keywords: ['none'],
    inherited: true,
  },
  color: { cssName: 'color', group: 'typography', accepts: ['color'], inherited: true },
  whiteSpace: {
    cssName: 'white-space',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'],
    inherited: true,
  },
  wordBreak: {
    cssName: 'word-break',
    group: 'typography',
    accepts: ['keyword'],
    keywords: ['normal', 'break-all', 'keep-all', 'break-word'],
    inherited: true,
  },

  /* ----------------------------- Background ------------------------------ */
  backgroundColor: {
    cssName: 'background-color',
    group: 'background',
    accepts: ['color'],
    inherited: false,
  },
  backgroundImage: {
    cssName: 'background-image',
    group: 'background',
    accepts: ['url', 'gradient', 'list', 'keyword'],
    keywords: ['none'],
    inherited: false,
  },
  backgroundSize: {
    cssName: 'background-size',
    group: 'background',
    accepts: ['keyword', 'length', 'list'],
    keywords: ['auto', 'cover', 'contain'],
    inherited: false,
  },
  backgroundPosition: {
    cssName: 'background-position',
    group: 'background',
    accepts: ['keyword', 'length', 'list'],
    keywords: ['left', 'right', 'top', 'bottom', 'center'],
    inherited: false,
  },
  backgroundRepeat: {
    cssName: 'background-repeat',
    group: 'background',
    accepts: ['keyword'],
    keywords: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round'],
    inherited: false,
  },
  backgroundAttachment: {
    cssName: 'background-attachment',
    group: 'background',
    accepts: ['keyword'],
    keywords: ['scroll', 'fixed', 'local'],
    inherited: false,
  },
  backgroundClip: {
    cssName: 'background-clip',
    group: 'background',
    accepts: ['keyword'],
    keywords: ['border-box', 'padding-box', 'content-box', 'text'],
    inherited: false,
  },
  backgroundOrigin: {
    cssName: 'background-origin',
    group: 'background',
    accepts: ['keyword'],
    keywords: ['border-box', 'padding-box', 'content-box'],
    inherited: false,
  },

  /* ------------------------------- Border -------------------------------- */
  borderTopWidth: {
    cssName: 'border-top-width',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderRightWidth: {
    cssName: 'border-right-width',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderBottomWidth: {
    cssName: 'border-bottom-width',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderLeftWidth: {
    cssName: 'border-left-width',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderTopStyle: {
    cssName: 'border-top-style',
    group: 'border',
    accepts: ['keyword'],
    keywords: LINE_STYLE_KEYWORDS,
    inherited: false,
  },
  borderRightStyle: {
    cssName: 'border-right-style',
    group: 'border',
    accepts: ['keyword'],
    keywords: LINE_STYLE_KEYWORDS,
    inherited: false,
  },
  borderBottomStyle: {
    cssName: 'border-bottom-style',
    group: 'border',
    accepts: ['keyword'],
    keywords: LINE_STYLE_KEYWORDS,
    inherited: false,
  },
  borderLeftStyle: {
    cssName: 'border-left-style',
    group: 'border',
    accepts: ['keyword'],
    keywords: LINE_STYLE_KEYWORDS,
    inherited: false,
  },
  borderTopColor: {
    cssName: 'border-top-color',
    group: 'border',
    accepts: ['color'],
    inherited: false,
  },
  borderRightColor: {
    cssName: 'border-right-color',
    group: 'border',
    accepts: ['color'],
    inherited: false,
  },
  borderBottomColor: {
    cssName: 'border-bottom-color',
    group: 'border',
    accepts: ['color'],
    inherited: false,
  },
  borderLeftColor: {
    cssName: 'border-left-color',
    group: 'border',
    accepts: ['color'],
    inherited: false,
  },
  borderTopLeftRadius: {
    cssName: 'border-top-left-radius',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderTopRightRadius: {
    cssName: 'border-top-right-radius',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderBottomRightRadius: {
    cssName: 'border-bottom-right-radius',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  borderBottomLeftRadius: {
    cssName: 'border-bottom-left-radius',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  outlineWidth: {
    cssName: 'outline-width',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },
  outlineStyle: {
    cssName: 'outline-style',
    group: 'border',
    accepts: ['keyword'],
    keywords: LINE_STYLE_KEYWORDS,
    inherited: false,
  },
  outlineColor: { cssName: 'outline-color', group: 'border', accepts: ['color'], inherited: false },
  outlineOffset: {
    cssName: 'outline-offset',
    group: 'border',
    accepts: ['length'],
    inherited: false,
  },

  /* ------------------------------ Effects -------------------------------- */
  boxShadow: {
    cssName: 'box-shadow',
    group: 'effects',
    accepts: ['shadow', 'list', 'keyword'],
    keywords: ['none'],
    inherited: false,
  },
  opacity: { cssName: 'opacity', group: 'effects', accepts: ['number'], inherited: false },
  filter: {
    cssName: 'filter',
    group: 'effects',
    accepts: ['keyword', 'raw'],
    keywords: ['none'],
    inherited: false,
  },
  backdropFilter: {
    cssName: 'backdrop-filter',
    group: 'effects',
    accepts: ['keyword', 'raw'],
    keywords: ['none'],
    inherited: false,
  },
  mixBlendMode: {
    cssName: 'mix-blend-mode',
    group: 'effects',
    accepts: ['keyword'],
    keywords: [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'difference',
      'exclusion',
    ],
    inherited: false,
  },

  /* ----------------------------- Transform ------------------------------- */
  transform: {
    cssName: 'transform',
    group: 'transform',
    accepts: ['transform', 'keyword'],
    keywords: ['none'],
    inherited: false,
  },
  transformOrigin: {
    cssName: 'transform-origin',
    group: 'transform',
    accepts: ['length', 'keyword', 'list'],
    keywords: ['center', 'top', 'right', 'bottom', 'left'],
    inherited: false,
  },
  perspective: {
    cssName: 'perspective',
    group: 'transform',
    accepts: ['length', 'keyword'],
    keywords: ['none'],
    inherited: false,
  },

  /* ---------------------------- Transitions ------------------------------ */
  transitionProperty: {
    cssName: 'transition-property',
    group: 'transition',
    accepts: ['keyword', 'list'],
    keywords: ['none', 'all'],
    inherited: false,
  },
  transitionDuration: {
    cssName: 'transition-duration',
    group: 'transition',
    accepts: ['time', 'list'],
    inherited: false,
  },
  transitionTimingFunction: {
    cssName: 'transition-timing-function',
    group: 'transition',
    accepts: ['keyword', 'list', 'raw'],
    keywords: EASING_KEYWORDS,
    inherited: false,
  },
  transitionDelay: {
    cssName: 'transition-delay',
    group: 'transition',
    accepts: ['time', 'list'],
    inherited: false,
  },

  /* ---------------------------- Animations ------------------------------- */
  animationName: {
    cssName: 'animation-name',
    group: 'animation',
    accepts: ['keyword', 'string', 'list'],
    keywords: ['none'],
    inherited: false,
  },
  animationDuration: {
    cssName: 'animation-duration',
    group: 'animation',
    accepts: ['time', 'list'],
    inherited: false,
  },
  animationTimingFunction: {
    cssName: 'animation-timing-function',
    group: 'animation',
    accepts: ['keyword', 'list', 'raw'],
    keywords: EASING_KEYWORDS,
    inherited: false,
  },
  animationDelay: {
    cssName: 'animation-delay',
    group: 'animation',
    accepts: ['time', 'list'],
    inherited: false,
  },
  animationIterationCount: {
    cssName: 'animation-iteration-count',
    group: 'animation',
    accepts: ['number', 'keyword', 'list'],
    keywords: ['infinite'],
    inherited: false,
  },
  animationDirection: {
    cssName: 'animation-direction',
    group: 'animation',
    accepts: ['keyword'],
    keywords: ['normal', 'reverse', 'alternate', 'alternate-reverse'],
    inherited: false,
  },
  animationFillMode: {
    cssName: 'animation-fill-mode',
    group: 'animation',
    accepts: ['keyword'],
    keywords: ['none', 'forwards', 'backwards', 'both'],
    inherited: false,
  },
  animationPlayState: {
    cssName: 'animation-play-state',
    group: 'animation',
    accepts: ['keyword'],
    keywords: ['running', 'paused'],
    inherited: false,
  },

  /* --------------------------- Interactivity ----------------------------- */
  cursor: {
    cssName: 'cursor',
    group: 'interactivity',
    accepts: ['keyword'],
    keywords: [
      'auto',
      'default',
      'pointer',
      'text',
      'move',
      'grab',
      'grabbing',
      'not-allowed',
      'crosshair',
      'col-resize',
      'row-resize',
    ],
    inherited: true,
  },
  pointerEvents: {
    cssName: 'pointer-events',
    group: 'interactivity',
    accepts: ['keyword'],
    keywords: ['auto', 'none'],
    inherited: true,
  },
  userSelect: {
    cssName: 'user-select',
    group: 'interactivity',
    accepts: ['keyword'],
    keywords: ['auto', 'none', 'text', 'all'],
    inherited: true,
  },
  visibility: {
    cssName: 'visibility',
    group: 'interactivity',
    accepts: ['keyword'],
    keywords: ['visible', 'hidden', 'collapse'],
    inherited: true,
  },
} as const satisfies Record<string, PropertyDefinition>;

/**
 * The set of every editable property, derived from the catalog rather than
 * maintained beside it. Adding a key above extends this union automatically.
 */
export type StyleProperty = keyof typeof STYLE_PROPERTIES;

export const STYLE_PROPERTY_NAMES = Object.keys(STYLE_PROPERTIES) as readonly StyleProperty[];

export function isStyleProperty(value: unknown): value is StyleProperty {
  return typeof value === 'string' && Object.hasOwn(STYLE_PROPERTIES, value);
}

export function propertyDefinition(property: StyleProperty): PropertyDefinition {
  return STYLE_PROPERTIES[property];
}

export function cssPropertyName(property: StyleProperty): string {
  return STYLE_PROPERTIES[property].cssName;
}

export function isInherited(property: StyleProperty): boolean {
  return STYLE_PROPERTIES[property].inherited;
}

export function propertiesInGroup(group: PropertyGroup): readonly StyleProperty[] {
  return STYLE_PROPERTY_NAMES.filter((name) => STYLE_PROPERTIES[name].group === group);
}

/**
 * Is this value legal for this property?
 *
 * Two universal exceptions, both deliberate:
 *
 *  - `token` is accepted everywhere. A design token stands in for any value, and
 *    the token's own type is checked where the token is defined. Enumerating
 *    `token` on all ninety properties would be noise.
 *
 *  - `raw` is accepted everywhere. It is the importer's escape hatch; rejecting
 *    it would mean silently dropping declarations we failed to model, making
 *    round-trip import lossy. Its danger is handled by sanitisation at
 *    serialisation, not by rejection here.
 *
 * Keyword values are additionally checked against the property's vocabulary — a
 * property that lists keywords will not accept one outside the list. That is
 * what turns `display: flexx` from a silently-dead declaration into an error the
 * editor can show.
 */
export function acceptsValue(property: StyleProperty, value: StyleValue): boolean {
  if (value.kind === 'token' || value.kind === 'raw') return true;

  const definition = STYLE_PROPERTIES[property];
  if (!(definition.accepts as readonly StyleValueKind[]).includes(value.kind)) return false;

  if (value.kind === 'keyword') {
    const keywords = 'keywords' in definition ? definition.keywords : undefined;
    // No vocabulary declared = any keyword allowed (e.g. font-family names).
    if (!keywords) return true;
    return (keywords as readonly string[]).includes(value.value);
  }

  return true;
}
