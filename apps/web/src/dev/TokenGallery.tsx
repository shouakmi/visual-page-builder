import { cssVarName, SEMANTIC_TOKENS, type SemanticToken } from '@vpb/tokens';
import { useTheme } from '@vpb/ui';
import { useEffect, useState } from 'react';

/**
 * Live view of every semantic token, read back out of the DOM.
 *
 * This is a diagnostic, not decoration. It proves the entire theming chain end
 * to end at a glance:
 *
 *   semantic.ts -> theme.css -> @theme inline -> Tailwind utility -> .dark swap
 *
 * A token that renders transparent here is one the CSS forgot; a token whose
 * value does not change when you flip the theme is one that got hard-coded
 * instead of var()-referenced. Both are invisible in a screenshot of a finished
 * UI and obvious here.
 *
 * It reads *computed* values rather than importing the TS constants on purpose —
 * importing them would only prove that TypeScript agrees with TypeScript.
 */
function useComputedTokens(): Map<SemanticToken, string> {
  const { resolved } = useTheme();
  const [values, setValues] = useState<Map<SemanticToken, string>>(new Map());

  useEffect(() => {
    // Read after paint so the `.dark` class toggle has been applied.
    const styles = getComputedStyle(document.documentElement);
    const next = new Map<SemanticToken, string>();
    for (const token of SEMANTIC_TOKENS) {
      next.set(token, styles.getPropertyValue(cssVarName(token)).trim());
    }
    setValues(next);
  }, [resolved]);

  return values;
}

function Swatch({ token, value }: { token: SemanticToken; value: string }) {
  const missing = value === '';

  return (
    <li className="flex items-center gap-3 rounded-md border border-border bg-surface-raised p-2">
      <span
        className="size-9 shrink-0 rounded border border-border-strong"
        style={{ background: `var(${cssVarName(token)})` }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs text-foreground">{token}</span>
        <span
          className={
            missing
              ? 'block truncate font-mono text-[11px] text-danger'
              : 'block truncate font-mono text-[11px] text-foreground-subtle'
          }
        >
          {missing ? 'UNDEFINED — missing from theme.css' : value}
        </span>
      </span>
    </li>
  );
}

export function TokenGallery() {
  const { resolved, preference } = useTheme();
  const values = useComputedTokens();
  const missing = SEMANTIC_TOKENS.filter((t) => values.get(t) === '');

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Phase A — Foundation</h1>
        <p className="text-sm text-foreground-muted">
          The workspace installs, typechecks, tests, builds, and themes. Every swatch below is read
          live from the DOM&apos;s computed custom properties — flip the theme in the top bar and
          watch them change.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 text-xs">
        <span className="text-foreground-muted">
          preference <code className="font-mono text-foreground">{preference}</code>
        </span>
        <span className="text-border-strong">|</span>
        <span className="text-foreground-muted">
          resolved <code className="font-mono text-foreground">{resolved}</code>
        </span>
        <span className="text-border-strong">|</span>
        <span className="text-foreground-muted">
          tokens <code className="font-mono text-foreground">{SEMANTIC_TOKENS.length}</code>
        </span>
        <span className="text-border-strong">|</span>
        {missing.length === 0 ? (
          <span className="font-medium text-success">all resolved</span>
        ) : (
          <span className="font-medium text-danger">{missing.length} undefined</span>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SEMANTIC_TOKENS.map((token) => (
          <Swatch key={token} token={token} value={values.get(token) ?? ''} />
        ))}
      </ul>
    </div>
  );
}
