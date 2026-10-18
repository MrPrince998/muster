import { createHash, randomBytes } from 'node:crypto';

/**
 * A random secret for refresh tokens and email links: 32 bytes (256 bits),
 * URL-safe so it can go in a link or cookie as-is.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What the database stores instead of the token. SHA-256, not bcrypt or
 * scrypt: the input is 256 random bits, so it cannot be guessed and a slow
 * hash adds nothing, while a fast one can be looked up through a unique index.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
