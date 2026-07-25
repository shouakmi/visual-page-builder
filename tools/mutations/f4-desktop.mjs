/**
 * PHASE F4 — the desktop-shaped `StorageAdapter` fake.
 *
 * Every mutation here is a regression that could plausibly land in Phase J's
 * REAL SQLite adapter, not a synthetic edit chosen to raise a coverage number:
 * a missing `OR REPLACE`, a forgotten `JSON.parse` on a TEXT column, a `Blob`
 * rebuilt without the `mime_type` column it needs, a result code mapped to the
 * wrong `StorageError`, the wrong table in a `SELECT`. Each is named in
 * `docs/phase-j-sqlite.md` as something the real adapter must get right.
 *
 * Runs against the `storage` project alone; every `find` is a single line.
 *
 * NOTE for anyone re-pointing these: `serializePayload` and `parsePayload` end
 * with byte-identical 4-space `return storageErr({ kind: 'corrupt', ... })`
 * lines, so neither is a usable `find`. The corrupt-mapping mutation targets the
 * 6-space line inside `mapError`'s switch, and the parse path is mutated at its
 * `JSON.parse` instead.
 */
export default {
  name: 'F4 — desktop-shaped storage adapter',
  testCommand: 'pnpm vitest run --project storage --silent',
  mutations: [
    {
      // THE ORDERING BUG. `INSERT OR REPLACE` runs, THEN the payload fails to
      // serialize — so a document that cannot be represented has just destroyed
      // the user's last good save and stored nothing in its place. Serializing
      // before the write transaction opens is what prevents it.
      name: 'a failed serialize clobbers the good row already stored under that id',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '      if (!payload.ok) return payload;',
      replace: '      if (!payload.ok) { tables.documents.delete(file.id); return payload; }',
    },
    {
      // `INSERT` where `INSERT OR REPLACE` was meant: every save after the first
      // silently does nothing, so the user's edits never reach the database.
      name: 'saveDocument inserts only, so an existing document is never overwritten',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '        tables.documents.set(file.id, {',
      replace: '        if (!tables.documents.has(file.id)) tables.documents.set(file.id, {',
    },
    {
      // The TEXT column is handed back as text. Every caller then receives a
      // string where a document was expected, and `deserializeDocumentFile`
      // rejects it as invalid shape — a load that always fails.
      name: 'loadDocument returns the raw TEXT column without parsing it',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '    return storageOk(JSON.parse(payload) as unknown);',
      replace: '    return storageOk(payload);',
    },
    {
      // A full disk reported as a generic I/O failure. The host can no longer
      // tell the user to free space, and autosave retries into the same wall.
      name: 'SQLITE_FULL is mapped to io-error instead of quota-exceeded',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: "      return storageErr({ kind: 'quota-exceeded' });",
      replace: "      return storageErr({ kind: 'io-error', detail: describe(error) });",
    },
    {
      // A damaged database file reported as a transient I/O failure invites the
      // host to retry forever instead of surfacing corruption.
      name: 'SQLITE_CORRUPT is mapped to io-error instead of corrupt',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: "      return storageErr({ kind: 'corrupt', detail: describe(error) });",
      replace: "      return storageErr({ kind: 'io-error', detail: describe(error) });",
    },
    {
      // `SELECT payload` and parse, instead of `SELECT name`. One corrupt
      // document then takes down the whole project manager — the user sees an
      // error where nine healthy projects should be.
      name: 'listDocuments parses every payload instead of reading the name column',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '          name: row.name,',
      replace:
        '          name: (JSON.parse(row.payload) as { project: { name: string } }).project.name,',
    },
    {
      // A BLOB column is typeless, so a `Blob` rebuilt without the `mime_type`
      // column has an empty type. The canvas resolver's object URL then carries
      // no content type and the browser refuses to paint the image.
      name: 'loadAssetBytes rebuilds the Blob without its mime-type column',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '        return storageOk(new Blob([row.bytes], { type: row.mimeType }));',
      replace: '        return storageOk(new Blob([row.bytes]));',
    },
    {
      // The `Blob` is bound to the BLOB parameter directly instead of its bytes.
      // A driver cannot bind a Blob; the desktop family must cross the binary
      // boundary explicitly, and this is where that gets forgotten.
      name: 'saveAssetBytes stores the Blob rather than the binary column',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '        const buffer = new Uint8Array(await bytes.arrayBuffer());',
      replace: '        const buffer = bytes as unknown as Uint8Array<ArrayBuffer>;',
    },
    {
      // A DELETE whose WHERE never matches. The bytes outlive their own
      // deletion, which is exactly the leak byte GC depends on this contract to
      // prevent.
      name: 'deleteAssetBytes does not actually remove the row',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '        tables.assets.delete(id);',
      replace: '',
    },
    {
      // The wrong table in the enumeration query. Byte GC would then subtract
      // live asset ids from a list of DOCUMENT ids and reap every stored blob.
      name: 'listAssetIds enumerates the documents table',
      file: 'packages/storage/src/desktopShapedStorageAdapter.ts',
      find: '      return storageOk([...tables.assets.keys()]);',
      replace: '      return storageOk([...tables.documents.keys()] as unknown as AssetId[]);',
    },
  ],
};
