declare const BRAND: unique symbol;

/**
 * Nominal typing for TypeScript's structural type system.
 *
 * `type NodeId = string` documents intent but enforces nothing: every function
 * taking a `NodeId` silently accepts a `PageId`, an `AssetId`, or a user's
 * display name. In a project whose entire domain is graphs of cross-referencing
 * ids, that class of mistake is both easy to make and miserable to debug —
 * passing a parent id where a child id belongs typechecks perfectly and corrupts
 * the tree at runtime.
 *
 * `Brand` attaches a phantom property that exists only in the type system. The
 * runtime value stays a plain string: zero cost, no wrapper objects, and ids
 * still serialise to JSON as strings.
 *
 * The brand is intentionally unforgeable from outside: `BRAND` is a
 * module-private unique symbol, so the only way to obtain a `NodeId` is through
 * the factories in `./idFactory.ts` or an explicit, greppable cast in a parser.
 */
export type Brand<T, B extends string> = T & { readonly [BRAND]: B };
