/**
 * PHASE F3 · Slice E — the upload pipeline and Asset panel.
 *
 * The validation guards (empty / oversize / unsupported / undecodable), the
 * bytes-first ordering that prevents metadata for never-stored bytes, the display
 * ordering, the missing-bytes indicator, and the delete-confirmation gate. Runs
 * against the `web` project alone; every `find` is a single line.
 */
export default {
  name: 'F3 — upload pipeline + asset panel',
  testCommand: 'pnpm vitest run --project web --silent',
  mutations: [
    {
      name: 'validateUpload accepts an empty file',
      file: 'apps/web/src/assetUpload.ts',
      find: "  if (file.size === 0) return { ok: false, failure: { kind: 'empty' } };",
      replace: '',
    },
    {
      name: 'validateUpload accepts a file over the size limit',
      file: 'apps/web/src/assetUpload.ts',
      find: "  if (file.size > maxBytes) return { ok: false, failure: { kind: 'too-large', maxBytes } };",
      replace: '',
    },
    {
      // Disabling the type check lets SVG and any other type through — the exact
      // XSS hole the accepted-set exists to close.
      name: 'validateUpload accepts any file type, including SVG',
      file: 'apps/web/src/assetUpload.ts',
      find: '  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {',
      replace: '  if (false) {',
    },
    {
      // Skipping the decode check accepts corrupt / spoofed images.
      name: 'validateUpload accepts a file that does not decode as an image',
      file: 'apps/web/src/assetUpload.ts',
      find: "  if (!size) return { ok: false, failure: { kind: 'undecodable' } };",
      replace: '',
    },
    {
      // Bytes-first violated: the metadata command runs even when the byte write
      // failed, leaving a record for bytes that were never stored.
      name: 'performUpload records metadata even when storing the bytes fails',
      file: 'apps/web/src/assetUpload.ts',
      find: '  if (!saved.ok) {',
      replace: '  if (false) {',
    },
    {
      // No sort: the panel shows assets in arbitrary insertion order.
      name: 'sortAssetsByNewest stops ordering',
      file: 'apps/web/src/assetUpload.ts',
      find: '    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,',
      replace: '    0,',
    },
    {
      // Inverting the missing check flags stored assets as missing and hides the
      // genuinely-missing ones.
      name: 'panel inverts the missing-bytes indicator',
      file: 'apps/web/src/AssetPanel.tsx',
      find: '            const missing = storedIds !== null && !storedIds.has(asset.id);',
      replace: '            const missing = storedIds !== null && storedIds.has(asset.id);',
    },
    {
      // Delete without confirmation: the delete button removes immediately.
      name: 'panel deletes an asset without the confirmation step',
      file: 'apps/web/src/AssetPanel.tsx',
      find: '                      onClick={() => setConfirmingDelete(asset.id)}',
      replace: '                      onClick={() => confirmDelete(asset.id)}',
    },
  ],
};
