/* Identity */
export type { Brand } from './identity/brand.ts';
export { unsafeId } from './identity/ids.ts';
export type {
  AssetId,
  BreakpointId,
  ClassName,
  ComponentId,
  NodeId,
  PageId,
  ProjectId,
  StyleRuleId,
  TokenId,
} from './identity/ids.ts';
export { createIdFactory, createDeterministicIdFactory } from './identity/idFactory.ts';
export type { IdFactory } from './identity/idFactory.ts';

/* Style — units */
export {
  LENGTH_UNITS,
  ANGLE_UNITS,
  TIME_UNITS,
  isLengthUnit,
  isAngleUnit,
  isTimeUnit,
  formatNumber,
} from './style/units.ts';
export type { LengthUnit, AngleUnit, TimeUnit } from './style/units.ts';

/* Style — colour */
export {
  rgb,
  hsl,
  hex,
  parseColor,
  formatColor,
  toRgb,
  colorsEqual,
  TRANSPARENT,
} from './style/color.ts';
export type { Color, Rgb } from './style/color.ts';

/* Style — values */
export {
  keyword,
  length,
  px,
  percent,
  rem,
  number,
  color,
  angle,
  deg,
  time,
  ms,
  str,
  token,
  url,
  list,
  raw,
  transform,
  shadow,
  linearGradient,
  radialGradient,
  stop,
  isKeyword,
  isLength,
  isNumber,
  isColor,
  isToken,
  isRaw,
  referencedTokens,
  referencedAssets,
} from './style/values.ts';
export type {
  StyleValue,
  StyleValueKind,
  KeywordValue,
  LengthValue,
  NumberValue,
  ColorValue,
  AngleValue,
  TimeValue,
  StringValue,
  TokenValue,
  UrlValue,
  ListValue,
  ShadowValue,
  GradientValue,
  GradientStop,
  TransformValue,
  TransformFunction,
  RawValue,
} from './style/values.ts';

/* Style — properties */
export {
  STYLE_PROPERTIES,
  STYLE_PROPERTY_NAMES,
  isStyleProperty,
  propertyDefinition,
  cssPropertyName,
  isInherited,
  propertiesInGroup,
  acceptsValue,
} from './style/properties.ts';
export type { StyleProperty, PropertyDefinition, PropertyGroup } from './style/properties.ts';

/* Style — serialisation */
export {
  serializeValue,
  isSafeRawCss,
  sanitizeRawCss,
  isSafeUrl,
  escapeCssString,
} from './style/serialize.ts';
export type { SerializeContext } from './style/serialize.ts';

/* Style — breakpoints */
export {
  BASE_BREAKPOINT_ID,
  TABLET_BREAKPOINT_ID,
  MOBILE_LANDSCAPE_BREAKPOINT_ID,
  MOBILE_BREAKPOINT_ID,
  defaultBreakpoints,
  createBreakpointSet,
  validateBreakpointSet,
  getBreakpoint,
  baseBreakpoint,
  cascadeChain,
  cssOrder,
  mediaQuery,
} from './style/breakpoints.ts';
export type { Breakpoint, BreakpointSet, MediaCondition } from './style/breakpoints.ts';

/* Style — targets */
export {
  STYLE_STATES,
  PSEUDO_ELEMENTS,
  target,
  targetKey,
  parseTargetKey,
  targetsEqual,
  isStyleState,
  isPseudoElement,
  stateSelector,
  pseudoSelector,
  stateLayers,
} from './style/target.ts';
export type { StyleState, PseudoElement, StyleTarget } from './style/target.ts';

/* Style — declarations */
export {
  EMPTY_DECLARATION,
  isEmptyDeclaration,
  declarationEntries,
  declarationProperties,
  getDeclaration,
  setDeclaration,
  unsetDeclaration,
  mergeDeclarations,
  declarationsEqual,
} from './style/declaration.ts';
export type { StyleDeclaration } from './style/declaration.ts';

/* Style — rules */
export {
  classScope,
  nodeScope,
  scopeKey,
  parseScopeKey,
  scopesEqual,
  isValidClassName,
} from './style/rule.ts';
export type { StyleRule, StyleScope } from './style/rule.ts';

/* Style — stylesheet */
export {
  EMPTY_STYLESHEET,
  createStyleSheet,
  allRules,
  ruleCount,
  getRule,
  findRule,
  rulesForScope,
  putRule,
  removeRule,
  removeRuleAt,
  removeScope,
  setProperty,
  unsetProperty,
  setDeclarations,
  setClassOrder,
  scopeKeys,
  orphanedRules,
  validateStyleSheet,
} from './style/stylesheet.ts';
export type { StyleSheet } from './style/stylesheet.ts';

/* Style — the compiler. ONE of these, shared by the canvas (D) and the exporter (I). */
export { compileStyleSheet, ruleSelector, nodeClassName } from './style/compile.ts';
export type { CompileOptions } from './style/compile.ts';

/* Style — cascade resolution */
export {
  resolveStyle,
  resolveDeclarations,
  resolveProperty,
  propertySources,
  isInheritedFromCascade,
} from './style/resolve.ts';
export type { StyleQuery, ResolvedStyle, ResolvedProperty } from './style/resolve.ts';

/* Node — props */
export {
  EMPTY_PROPS,
  propString,
  propNumber,
  propBoolean,
  propAsset,
  propUrl,
  acceptsPropValue,
  getProp,
  setProp,
  unsetProp,
  propToString,
  referencedAssets as referencedPropAssets,
  propsEqual,
} from './node/props.ts';
export type {
  PropValue,
  PropValueKind,
  PropValues,
  PropType,
  PropOption,
  PropDefinition,
} from './node/props.ts';

/* Node — component registry */
export {
  EMPTY_REGISTRY,
  createRegistry,
  registerComponent,
  unregisterComponent,
  getComponent,
  hasComponent,
  allComponents,
  componentsInCategory,
  propDefinition,
  initialProps,
  canContain,
  validateProps,
  validateRegistry,
} from './node/component.ts';
export type {
  ComponentDefinition,
  ComponentRegistry,
  ComponentCategory,
  ChildPolicy,
} from './node/component.ts';

/* Node — builtin components */
export {
  BODY_COMPONENT_ID,
  SECTION_COMPONENT_ID,
  BOX_COMPONENT_ID,
  HEADING_COMPONENT_ID,
  TEXT_COMPONENT_ID,
  IMAGE_COMPONENT_ID,
  LINK_COMPONENT_ID,
  BUTTON_COMPONENT_ID,
  BUILTIN_COMPONENTS,
  bodyComponent,
  sectionComponent,
  boxComponent,
  headingComponent,
  textComponent,
  imageComponent,
  linkComponent,
  buttonComponent,
  createBuiltinRegistry,
} from './node/builtins.ts';

/* Node — nodes */
export {
  createNode,
  nodeName,
  setNodeProp,
  unsetNodeProp,
  setNodeProps,
  hasClass,
  addClass,
  removeClass,
  setClasses,
  renameNode,
  setLocked,
  setHidden,
} from './node/node.ts';
export type { Node } from './node/node.ts';

/* Node — tree */
export {
  createTree,
  buildNodeTree,
  getNode,
  hasNode,
  nodeCount,
  rootNode,
  parentOf,
  parentIdOf,
  childIdsOf,
  childrenOf,
  siblingIndex,
  ancestorIds,
  nodePath,
  depthOf,
  isAncestor,
  subtreeIds,
  descendantIds,
  walk,
  findNodes,
  nodesWithClass,
  treeAssets,
  updateNode,
  updateNodeBy,
  insertNode,
  insertSubtree,
  removeNode,
  canMoveNode,
  moveNode,
  duplicateNode,
  canInsertComponent,
  canDropNode,
  validateTree,
  unknownComponentNodes,
} from './node/tree.ts';
export type { NodeTree } from './node/tree.ts';

/* Document — assets */
export {
  EMPTY_ASSET_LIBRARY,
  createAssetLibrary,
  getAsset,
  allAssets,
  putAsset,
  removeAsset,
  isImageAsset,
} from './document/asset.ts';
export type { Asset, AssetLibrary } from './document/asset.ts';

/* Document — pages */
export {
  EMPTY_SEO,
  HOME_PATH,
  normalizePath,
  isValidPagePath,
  createPage,
  setPageTree,
  renamePage,
  setPagePath,
  setPageSeo,
  validatePage,
} from './document/page.ts';
export type { Page, PageSeo } from './document/page.ts';

/* Document — project */
export {
  DEFAULT_SETTINGS,
  createProject,
  getPage,
  pageAtPath,
  homePage,
  pathInUse,
  addPage,
  updatePage,
  updatePageBy,
  removePage,
  movePage,
  duplicatePage,
  setStyles,
  setBreakpoints,
  setAssets,
  setSettings,
  renameProject,
  classUsage,
  usedAssets,
  orphanedNodeScopes,
  validateProject,
} from './document/project.ts';
export type { Project, ProjectSettings } from './document/project.ts';

/* Document — serialization (Phase F1). Maps <-> JSON-safe arrays, schema-versioned. */
export {
  SCHEMA_VERSION,
  serializeProject,
  createDocumentFile,
  deserializeProject,
  deserializeDocumentFile,
} from './document/serialize.ts';
export type {
  PageFileV1,
  ProjectFileV1,
  DocumentFile,
  LoadedDocument,
  DeserializeError,
  DeserializeProjectResult,
  DeserializeDocumentResult,
} from './document/serialize.ts';
