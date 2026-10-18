/**
 * Escapes text for HTML element content and quoted attribute values. Every
 * value that is not a literal in a template goes through this: a user's name
 * like `<a href="evil">` must arrive as text, not markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "30 minutes", "1 hour", "24 hours" */
export function formatDuration(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
