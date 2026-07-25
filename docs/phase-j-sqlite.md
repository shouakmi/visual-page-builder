# Phase J — the real SQLite `StorageAdapter`

A design record, written in Phase F4. **Nothing here is implemented.** F4's scope is explicit: no
Electron, no `better-sqlite3`, no Node-specific database code. What F4 built is a *desktop-shaped
fake* (`packages/storage/src/desktopShapedStorageAdapter.ts`) that models SQLite's **serialization
contract** — a JSON text column plus a binary column — so the cross-adapter contract suite is proven
across both serialization families before Phase J writes a line of SQL.

This document is what Phase J should be handed. It records the schema, the transaction model, the
Electron boundary, the error taxonomy, the build implications, and — just as importantly — the things
the fake does **not** prove and the two decisions still open.

The [README](../README.md) is the contract and [HANDOFF](../HANDOFF.md) is the news; this is a plan.
Where it disagrees with either after Phase J starts, they win.

---

## 1. Proposed schema

```sql
CREATE TABLE documents (
  id             TEXT    PRIMARY KEY NOT NULL,
  name           TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,   -- ISO 8601, the caller's clock
  schema_version INTEGER NOT NULL,   -- triage only; see below
  payload        TEXT    NOT NULL    -- the whole DocumentFile as JSON
) STRICT;

CREATE INDEX documents_updated_at ON documents (updated_at DESC);

CREATE TABLE assets (
  id        TEXT    PRIMARY KEY NOT NULL,
  mime_type TEXT    NOT NULL,
  byte_size INTEGER NOT NULL,
  bytes     BLOB    NOT NULL
) STRICT;
```

**`STRICT` tables.** SQLite's default is dynamic typing: a `TEXT` column will happily store an
integer. `STRICT` turns the declared types into real constraints, which is the whole reason for
declaring them. Requires SQLite 3.37+ (2021); `better-sqlite3` has shipped well past that for years.

**`id TEXT PRIMARY KEY`, not `INTEGER`/rowid.** The ids are already branded strings minted by
`@vpb/core`'s `IdFactory` and are the identity the whole model uses. Introducing a second, numeric
identity would create two answers to "which document is this".

**`documents_updated_at`** serves the "recent projects" ordering a project manager wants. `assets`
needs no index beyond its primary key: every access is by `AssetId`, and `listAssetIds` is a full key
scan by definition.

**No foreign key from `assets` to `documents`, deliberately.** Asset bytes intentionally outlive the
document that referenced them — `removeAssetCommand` leaves bytes behind so an undo can restore the
record and still find them. A cascade delete would turn undo into data loss. This is also the root of
the byte-GC hazard in §9.

### Why metadata is denormalised out of the payload

`name`, `updated_at` and `schema_version` all exist *inside* the JSON payload. Storing them again as
columns is duplication, and it is correct:

1. **`listDocuments` must not parse.** A project manager listing 200 documents cannot deserialize 200
   JSON blobs to render a list. The read is `SELECT id, name, updated_at FROM documents ORDER BY
   updated_at DESC` and never touches `payload`.
2. **A corrupt payload must not empty the list.** This is the sharper reason, and it is pinned by a
   test today (`lists documents from the persisted columns, not by parsing each payload`). If listing
   parsed payloads, one damaged document would take down the entire project manager — the user would
   see nothing rather than seeing their other nine projects and one broken entry.
3. **Triage without deserialization.** `schema_version` as a column lets a migration pass ask "is
   anything in this database older than the app understands" with one query.

**Authority, stated once so it is never ambiguous:** the columns are a *derived cache*, written from
the payload at save time. On any disagreement the **payload wins**, because
`deserializeDocumentFile` reads the envelope and nothing else. Nothing may reconstruct a
`DocumentFile` from the columns.

---

## 2. Transactions and atomicity

### Serialize before the write transaction opens

```
JSON.stringify(file)   →   BEGIN   →   INSERT OR REPLACE   →   COMMIT
```

Never the other order. This is F4's highest-value finding and is pinned by
`leaves a good row intact when the replacing payload cannot be serialized`: a document that cannot be
represented as JSON must fail **before** anything is written, or a failed save destroys the user's
last good version of that document and stores nothing in its place. A write-then-serialize
implementation loses data on exactly the input it was trying to reject.

Concretely: build the payload string, and only if that succeeds bind it and run the statement. The
cost is one extra string in memory; the alternative is a data-loss class of bug.

### One atomic transaction per adapter call

Each of the seven `StorageAdapter` methods is one transaction. That is the whole guarantee, and it is
the same one `storageAdapter.ts` already states: *"one atomic transaction per `saveDocument` call is
the whole guarantee; nothing here spans two documents."* Phase J must not widen it — a cross-document
transaction API would be a new contract, needed by nobody today.

Each call therefore either fully happened or did not happen at all. `better-sqlite3` is synchronous,
so a transaction cannot be accidentally left open across an `await` — the failure mode F2 had to work
around in IndexedDB does not exist here.

### Partial failure

On any driver throw inside the transaction: roll back, map the error (§4), return a
`StorageResult` — **never** rethrow past the adapter boundary. After a failed call:

- the target row is unchanged (or still absent, if it was an insert);
- every other row is unchanged;
- the failed id is **not** enumerable — it does not appear in `listDocuments` or `listAssetIds`.

That last clause is not decoration. A half-written asset id that `listAssetIds` reports but whose
bytes are absent is precisely what a future byte-GC pass would act on. Both atomicity tests in the
fake's suite assert enumeration explicitly for this reason.

### Documents and assets stay independently consistent

They are separate tables with no foreign key, written by separate calls in separate transactions.
There is deliberately **no** operation that writes a document and its assets together.

The consistency that matters is upheld by ordering in the layer above, not by the database:
`performUpload` in `apps/web` writes the **bytes first**, and only on success records the metadata
command. So the model can never hold a record for bytes that were never stored. The reverse — bytes
with no record — is the tolerated direction, because it is recoverable (that is what byte GC is for)
whereas a broken image reference in a saved document is not.

Phase J inherits that ordering unchanged. Do not "improve" it into a joint transaction.

---

## 3. The Electron boundary

### SQLite lives in the main process. Only there.

The renderer gets **no** database handle, no file path, and no `better-sqlite3` import. Reasons, in
order of severity:

1. `better-sqlite3` is a native module. Loading it in a renderer means `nodeIntegration: true`, which
   AUDIT §4.9 already found the prototype doing wrong and which forfeits the sandbox.
2. The renderer runs project content. A renderer with a database handle is one XSS away from
   arbitrary reads and writes over every document the user owns.
3. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and a real CSP are the
   baseline Phase J owes anyway (AUDIT §4.9: "no `webPreferences`, no preload, no IPC, no CSP").

### Proposed preload API

The bridge mirrors `StorageAdapter` exactly — seven methods, no more. A wider surface is a wider
attack surface, and anything not in the contract has no caller.

```ts
// preload.ts — the ONLY thing exposed to the renderer.
contextBridge.exposeInMainWorld('vpbStorage', {
  listDocuments: () => ipcRenderer.invoke('vpb:storage/listDocuments'),
  loadDocument: (id: string) => ipcRenderer.invoke('vpb:storage/loadDocument', id),
  saveDocument: (file: unknown) => ipcRenderer.invoke('vpb:storage/saveDocument', file),
  deleteDocument: (id: string) => ipcRenderer.invoke('vpb:storage/deleteDocument', id),
  saveAssetBytes: (id: string, bytes: ArrayBuffer, mimeType: string) =>
    ipcRenderer.invoke('vpb:storage/saveAssetBytes', id, bytes, mimeType),
  loadAssetBytes: (id: string) => ipcRenderer.invoke('vpb:storage/loadAssetBytes', id),
  deleteAssetBytes: (id: string) => ipcRenderer.invoke('vpb:storage/deleteAssetBytes', id),
});
```

`apps/web` then constructs an adapter that forwards to `window.vpbStorage` — the same shape as
`createBrowserStorage(factory)` today: one host-specific line, and the rest of the app sees a plain
`StorageAdapter`.

**`ArrayBuffer` crosses the bridge, not `Blob`.** Electron's IPC uses the structured clone algorithm,
and passing a `Blob` through it is at best version-dependent. Send raw bytes and rebuild the `Blob`
**on the renderer side**, from the bytes plus the `mime_type` the main process returned. This is
exactly the split the desktop-shaped fake already models — the fake reconstructs its `Blob` from a
binary column and a type column, which turns out to be the right shape for the IPC boundary too, not
just for SQL.

### Validation and error translation at the boundary

The main process treats **everything from the renderer as untrusted**, on the same principle
`loadDocument` returning `unknown` already encodes:

- Every id is checked to be a string of bounded length before it reaches a statement. (Parameter
  binding already prevents injection; the bound is against a renderer sending 50 MB as an id.)
- `saveDocument`'s argument is `unknown` and is validated at the boundary before being stringified.
  Phase J should decide whether this is a shape check in main or a full
  `deserializeDocumentFile` round-trip — the latter is stricter but duplicates work the store already
  did. (Recorded in §10 as open.)
- Asset byte length is checked against the same ceiling `assetUpload.ts` enforces
  (`MAX_ASSET_BYTES`), because the renderer's check is a UX affordance, not a security control.
- Only the seven named channels are registered. No generic "run this query" channel, ever.

**Errors are translated, never forwarded.** The main process returns a `StorageResult` — the same
discriminated union everything else in this codebase uses. It must not send `Error` objects across:
they carry stack traces and absolute filesystem paths into a context that runs project content, and
they do not structured-clone into anything useful anyway. A `StorageError` is a plain, typed,
inspectable value, which is what the renderer needs and all it should get.

---

## 4. `StorageError` mapping

Keyed off the driver's **result code**, never a message string — messages are localised and change
between versions. This mirrors F2's mapping by DOMException *name* and is implemented today in the
fake's `mapError`.

| Condition | `StorageError` |
| --- | --- |
| `SQLITE_FULL` | `quota-exceeded` |
| `SQLITE_CORRUPT`, `SQLITE_NOTADB` | `corrupt` |
| No row for the given id | `not-found` |
| Any other driver failure | `io-error` |
| `payload` will not `JSON.parse` | `corrupt` — **independent of any SQLite code** |
| `DocumentFile` will not `JSON.stringify` | `corrupt` — before the transaction opens (§2) |

Two clauses worth keeping deliberately:

**The default is `io-error`, and it is the pessimistic one.** An unrecognised code must never be
guessed into something the host would act on differently — telling a user their disk is full when the
database is actually locked sends them to delete files for no reason.

**A malformed payload is `corrupt`, not `not-found`.** The row exists. `not-found` would tell the
host the document was never there, and a project manager would then reasonably offer to remove the
entry — destroying a row that a hex editor might still have recovered.

---

## 5. Serialization model

| What | Column | Notes |
| --- | --- | --- |
| `DocumentFile` | `payload TEXT` | `JSON.stringify` / `JSON.parse`. Untrusted on read: returned as `unknown`, validated by `@vpb/core`'s `deserializeDocumentFile`. |
| Asset bytes | `bytes BLOB` | Raw bytes. `Blob` → `Uint8Array` on write, rebuilt on read. |
| Asset type | `mime_type TEXT` | Its own column — a BLOB column is typeless. |

`listDocuments` reads `id`, `name`, `updated_at` and **never** `payload` (§1).

That `DocumentFile` survives a JSON round-trip with no field added or lost is now proven rather than
assumed: the shared contract's `round-trips a REAL project document with no field added or lost` runs
a document built through core's own API — real node tree, real breakpoint graph, real style rule, real
asset with `width`/`height` populated — through `createDocumentFile` and asserts `toStrictEqual`
across all three adapters. It holds because core omits absent optional fields rather than setting them
to `undefined` (`createNode`'s `...(overrides.name === undefined ? {} : { name })`), which
`exactOptionalPropertyTypes` enforces upstream. **If that discipline ever lapses, the desktop adapter's
copy of that test is what fails**, because `JSON.stringify` drops an `undefined`-valued key while a
structured clone preserves it.

### Decision: `mime_type` column beats `Blob.type`

The two serialization families disagree, and the disagreement is now recorded rather than latent:

- **Structured-clone family** (memory, IndexedDB): the stored `Blob` carries its own `type`, so the
  blob's type is what comes back and the `mimeType` argument is effectively ignored on read.
- **Desktop family** (the fake, and Phase J's real adapter): a BLOB column is typeless, so the `Blob`
  is reconstructed from the `mime_type` column — the `mimeType` **argument** is authoritative.

**For Phase J: the `mime_type` column is authoritative.** It is the only value the desktop family
actually has, and it is the parameter the contract asks callers to supply.

This divergence is **unreachable from product code today**: `performUpload` passes
`validated.asset.mimeType`, which is `file.type`, so the two are always equal — which is why the
shared contract tests only the aligned case (`preserves an asset mime type through the round-trip`)
rather than inventing a requirement no caller can exercise. If a caller ever *can* make them differ,
close it as a contract clause in `storageAdapter.ts` and add a shared test, rather than letting two
adapter families answer differently. Recorded as open in §10.

---

## 6. Build and packaging

### Where we are

Every package's `exports` points at `src/index.ts`. There is no build step and no `dist` — Vite
transpiles workspace sources as part of the app graph and `tsc --noEmit` is the type gate. The README
already names the limit and the moment it comes due:

> Source-only packages cannot be `require`d by plain Node. That is fine today — nothing outside the
> bundler consumes them. When Electron's **main** process needs shared code (Phase F/J, e.g.
> `@vpb/storage`), *that* package gets a real build and a dual `exports` map.

Phase J is that moment.

### What actually has to be built — smaller than expected

**`@vpb/storage`'s production code has no runtime dependency on `@vpb/core`.** Verified while writing
this: every `@vpb/core` import in `storageAdapter.ts`, `memoryStorageAdapter.ts`,
`indexedDbStorageAdapter.ts` and `desktopShapedStorageAdapter.ts` is `import type`, and the only
runtime imports are internal (`./storageAdapter.ts`, for `storageOk`/`storageErr`). The one runtime
`@vpb/core` import in the package — `unsafeId` in `storageAdapter.contract.ts` — is test-only and is
deliberately not barrel-exported.

So building `@vpb/storage` for the main process does **not** drag `@vpb/core` along. That is a
meaningful reduction in what Phase J has to package, and it is a property worth *keeping*: if a
runtime `@vpb/core` import ever lands in `@vpb/storage`, the main-process build grows a second
package overnight. Worth a lint rule or a build-time assertion when the build exists.

### Proposed dual `exports`

```jsonc
{
  "name": "@vpb/storage",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",   // Node / Electron main
      "default": "./src/index.ts"    // bundler, unchanged
    }
  }
}
```

The browser path stays source-consumed exactly as today — no rebuild loop, no stale `dist` for the
app developer. Only the Node consumer resolves the built artifact. **Do not implement this in F4.**

The real SQLite adapter should live in its own module (`sqliteStorageAdapter.ts`) and be exported
through a **subpath** (`@vpb/storage/node`), not the root barrel, so that a browser bundle can never
pull `better-sqlite3` into its module graph — the same reasoning that keeps
`storageAdapter.contract.ts` out of the barrel because it imports `vitest`.

---

## 7. What the desktop-shaped fake proves — and what it does not

### It proves

- **Serialization-model independence of the contract.** Before F4, both adapters round-tripped
  through structured clone, so the shared suite proved agreement only *within* one family. The fake
  is the second family, so the contract is now proven across both.
- **`DocumentFile` is genuinely JSON-clean**, against a real document built through core's API.
- **The invariants a JSON+BLOB adapter must satisfy**: serialize-before-write ordering, listing from
  columns, mime type in its own column, error mapping by result code, per-call atomicity including
  non-enumerability of a failed write.
- **That these tests can fail.** Each was falsified against a deliberately broken adapter before being
  accepted; five one-line mutations of the fake were each caught by exactly the test that should have
  caught it.

### It does not prove

- **Any claim about SQLite or its driver.** No SQL is parsed, no statement is prepared, no file is
  written. A bug in the real `INSERT OR REPLACE`, in parameter binding, or in `better-sqlite3` itself
  is entirely invisible here.
- **Locking and concurrency.** `SQLITE_BUSY`, WAL mode, two processes on one database file, a second
  window — none of it is modelled. The fake is single-threaded, in-process maps.
- **Migrations.** Both axes: the SQLite table shape (`PRAGMA user_version`) and the document
  `schemaVersion` chain. `MIGRATIONS` in `serialize.ts` is still empty, by design.
- **Durability.** No `fsync`, no crash, no torn write, no power loss. "The transaction resolved"
  means a `Map` was updated.
- **IPC security.** No Electron, no preload, no contextBridge, no CSP.
- **Real quota behaviour.** `SQLITE_FULL` is *mapped* correctly; nothing here has ever filled a disk.

### The fake under-promises, which is the safe direction

Its atomicity is per-call and effectively single-statement — a `Map.set` either threw or did not.
Real SQLite gives genuine transactional atomicity, which is **stronger**. So an adapter that satisfies
the fake's guarantees will satisfy them under real SQLite too; the implication does not run backwards.

That asymmetry is deliberate and should stay. A fake that promised *more* than the contract requires
would let Phase J ship an adapter that passes here and loses data in production. This one cannot.

---

## 8. Testing the real adapter

**Tier 1 — the same shared contract.** `runStorageAdapterContractTests('sqlite', …)` against a real
database, exactly as the other three adapters do. Non-negotiable: it is the entire reason the suite is
shared. A temp-file database per `makeAdapter()` keeps tests isolated; `:memory:` is tempting and
wrong, because it skips the filesystem, which is half of what is being tested.

**Tier 2 — real-driver integration.** Adapter-specific, in its own test file, mirroring how the
IndexedDB and desktop adapters keep their specifics out of the shared suite:

- **Corruption.** Truncate the file mid-database, overwrite the header with garbage → `corrupt`, not a
  crash. Also a valid database with a `payload` that is not JSON → `corrupt`, and the document list
  still works.
- **Quota / disk full.** `PRAGMA max_page_count` is the practical way to provoke a genuine
  `SQLITE_FULL` without a full disk — the smallest justified seam, in the spirit of F2's
  quota-mapping test.
- **Migrations.** Both axes, separately: a database at `user_version = 0` migrating to current, and a
  stored document at an older `schemaVersion` walking the `MIGRATIONS` chain. Also that a *newer*
  schema version is refused rather than guessed at.
- **Locking.** Two connections, one holding a write transaction → assert the second's mapped error is
  the one Phase J decides on (§10), and that WAL mode lets a read proceed during a write.
- **Crash recovery.** Kill the process mid-transaction, reopen, assert the database is consistent and
  the last committed document intact. This is the test the fake most conspicuously cannot substitute
  for.

**Tier 3 — the IPC boundary.** That a malformed renderer message is rejected rather than reaching a
statement; that an `Error` never crosses the bridge; that no channel beyond the seven is registered.

---

## 9. Recorded hazard: byte GC across documents

**Recorded here, not decided here.** This is an open F3 slice; F4 changes nothing about it.

The load-time byte-GC sweep is unimplemented. Its primitives all exist — `usedAssets`/`orphanedAssets`
in `@vpb/core`, `listAssetIds` + `deleteAssetBytes` on every adapter, and `removeAssetCommand`
deliberately leaving bytes behind — but no load path subtracts live ids from stored ids and reaps the
remainder.

**The naive implementation is destructive.** Asset bytes are stored **globally**: one `assets` object
store in IndexedDB today, one `assets` table in the schema above, keyed by bare `AssetId` with no
document scoping. But `usedAssets(project)` is **per-document**. So a load-time sweep computing
`listAssetIds() − loadedProject.assets` would delete the asset bytes belonging to **every other saved
document** — silent, unrecoverable data loss, and precisely what `orphanedAssets`' own comment
disclaims when it says the model "surfaces leaks, it does not destroy the user's work."

The design options, recorded without preference:

1. **Namespace asset keys per document** (`<projectId>/<assetId>`). Makes the subtraction correct by
   construction and makes "delete this project's bytes" a prefix scan. Costs a storage-key migration
   and duplicates bytes shared between documents.
2. **Union across all stored documents.** Compute live ids as the union of `usedAssets` over every
   document in `listDocuments`. Correct with today's keys and no migration, but every GC pass
   deserializes every document, and it is wrong the moment a document exists that this database has
   not seen.
3. **Reference counting** in a third table. Cheapest sweep, but a count that drifts is worse than no
   count, and undo/redo moving asset records in and out of the model makes drift easy.
4. **Never sweep automatically** — report orphans in the asset panel and require a manual, confirmed
   delete, exactly as `orphanedAssets` was designed for.

Whichever is chosen, the schema in §1 is compatible: option 1 changes only the key format, and options
2–4 need no schema change at all. Phase J does **not** need to resolve this to ship a SQLite adapter.

---

## 10. Open decisions

Recorded so Phase J decides them deliberately rather than by accident.

1. **`SQLITE_BUSY` has no home in the taxonomy.** It is *transient and retryable*, unlike everything
   `io-error` currently means. Options: map to `io-error` (lossy — the host cannot know to retry), add
   a `busy`/`locked` kind to `StorageError` (a contract change every adapter must handle), or retry
   with backoff inside the adapter and surface only the terminal failure. Becomes real the moment a
   second window or an export worker opens the same database.
2. **How strictly main validates `saveDocument`'s payload** — a boundary shape check, or a full
   `deserializeDocumentFile` round-trip in the main process (stricter, but duplicates work the store
   already did and puts core's validation on the IPC hot path).
3. **`Blob.type` vs `mime_type` precedence across families** (§5). Decided *for Phase J*; unreachable
   from product code today; should become a shared contract clause if a caller can ever make them
   disagree.
4. **Byte GC** (§9) — four options, none chosen.
