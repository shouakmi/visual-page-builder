import { Button } from '../components/Button.tsx';
import type { ThemePreference } from './theme.ts';
import { useTheme } from './useTheme.ts';

const LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

function Icon({ preference }: { preference: ThemePreference }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (preference === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (preference === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/**
 * Cycles light -> dark -> system.
 *
 * Accessibility detail worth stating: the accessible name announces both the
 * current state AND the effect of activating, because a lone icon is
 * meaningless to a screen reader and "Theme" alone would not tell the user what
 * pressing it does. When `system` is active we also announce what it resolved
 * to, since "System" by itself does not tell you whether you are looking at a
 * light or dark UI.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, toggle } = useTheme();

  const state = preference === 'system' ? `System (${resolved})` : LABELS[preference];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className={className}
      aria-label={`Theme: ${state}. Activate to switch.`}
      title={`Theme: ${state}`}
      data-theme-preference={preference}
      data-theme-resolved={resolved}
    >
      <Icon preference={preference} />
      <span>{LABELS[preference]}</span>
    </Button>
  );
}
