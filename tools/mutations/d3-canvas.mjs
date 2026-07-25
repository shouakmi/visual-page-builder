/**
 * PHASE D3 — the sandboxed canvas.
 *
 * AUDIT §4.5: the prototype's iframe "is created via `doc.write` from the
 * parent, making it same-origin — it has full access to the editor's
 * localStorage and DOM. It carries no sandbox attribute." §4.6: it rewrote the
 * document on every state change, so a click restarted every script and lost
 * scroll, focus and form state.
 *
 * Every mutation here is a plausible "fix". Adding `allow-scripts` is what a
 * developer does when the user's embed does not run. Replacing the style element
 * is what you write if you have not thought about the slider. Neither breaks
 * anything visible; both give back a hole the phase exists to close.
 */
export default {
  name: 'D3 — sandboxed canvas',
  testCommand: 'pnpm vitest run --project renderer --silent',
  mutations: [
    /* ---- the sandbox pairing ------------------------------------------- */
    {
      // THE ONE THAT MATTERS. allow-same-origin WITH allow-scripts is famously
      // not a sandbox: content reaches up and removes the attribute from its own
      // frame. This is the prototype's hole, restored by someone making an embed
      // work.
      name: 'allow-scripts added alongside allow-same-origin',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '      sandbox="allow-same-origin"',
      replace: '      sandbox="allow-same-origin allow-scripts"',
    },
    {
      // Without allow-same-origin the parent cannot reach contentDocument, so
      // the portal never mounts -- which is the pressure that pushes a
      // frustrated developer back to doc.write.
      name: 'sandbox attribute removed entirely',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '      sandbox="allow-same-origin"\n',
      replace: '',
    },

    /* ---- §4.6: incremental, not rewritten ------------------------------ */
    {
      // The prototype's exact failure: a fresh document per change. Scroll,
      // focus, form state and every in-flight request go with it.
      name: 'style element replaced instead of written to',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '    const style = ensureStyle(doc);',
      replace:
        "    doc.head.querySelector('style[data-vpb-canvas]')?.remove();\n    const style = ensureStyle(doc);",
    },
    {
      // Creating a style per render leaves a stack of them: the cascade still
      // works (last wins) and the head grows without bound for the life of the
      // session.
      name: 'a new style element created on every css change',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: "  const existing = doc.head.querySelector<HTMLStyleElement>('style[data-vpb-canvas]');\n  if (existing) return existing;",
      replace: '',
    },

    /* ---- what reaches the frame ---------------------------------------- */
    {
      name: 'compiled CSS never injected',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '    const next = `${RESET}\\n${css}`;',
      replace: '    const next = RESET;',
    },
    {
      // Without the reset the frame carries the UA's 8px body margin and the
      // canvas disagrees with the export by 8 pixels on every page.
      name: 'frame reset dropped',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: "const RESET = 'html,body{margin:0;padding:0}';",
      replace: "const RESET = '';",
    },
    {
      // Rendering the page into the EDITOR's document instead of the frame's:
      // the whole point of the iframe -- style isolation and honest media
      // queries -- silently gone.
      name: 'page rendered into the parent document instead of the frame',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '      {doc && createPortal(children, doc.body)}',
      replace: '      {doc && children}',
    },

    /* ---- the frame's own lifecycle -------------------------------------- */
    {
      // onReady in the dependency array re-adopts the document whenever the host
      // passes a new closure -- i.e. on every parent render.
      name: 'document re-adopted whenever the host re-renders',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);',
      replace: '  }, [onReady]);',
    },
    {
      name: 'frame given an accessible name that is not the caller title',
      file: 'packages/renderer/src/CanvasFrame.tsx',
      find: '      title={title}',
      replace: '      title="canvas"',
    },
  ],
};
