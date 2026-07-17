export type ClassValue = string | number | null | undefined | false | ClassValue[];

/**
 * Join conditional class names.
 *
 * Deliberately dependency-free (`clsx` is excellent but this is nine lines) and
 * deliberately NOT a Tailwind class merger. We do not resolve conflicts like
 * `p-2 p-4` — components own their base classes and consumers append, so the
 * cascade order is enough. If real conflict resolution is ever needed we adopt
 * `tailwind-merge` rather than growing this.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value && value !== 0) continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value));
    }
  }
  return out.join(' ');
}
