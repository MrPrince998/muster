// refresh token cookie: httpOnly, sent only to /auth routes
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/auth';

// session (refresh token) lifetime, absolute from sign-in
export const SESSION_TTL_DAYS = 30;

// single-use email links
export const VERIFY_EMAIL_TTL_MINUTES = 24 * 60;
export const RESET_PASSWORD_TTL_MINUTES = 30;
