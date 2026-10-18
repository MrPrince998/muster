// Paths the frontend or API use for their own pages; a workspace called
// "settings" must not shadow /o/settings.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin', 'api', 'app', 'auth', 'create', 'dashboard', 'docs', 'help', 'join',
  'login', 'logout', 'me', 'new', 'o', 'settings', 'signin', 'signup', 'support', 'www',
]);

// same rule as the organisations_slug_format CHECK
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;

/** "État Université!" -> "etat-universite"; never shorter than the minimum. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH - 5) // room for a "-xxxx" suffix
    .replace(/-+$/g, '');
  return slug.length >= SLUG_MIN_LENGTH && !RESERVED_SLUGS.has(slug) ? slug : 'workspace';
}
