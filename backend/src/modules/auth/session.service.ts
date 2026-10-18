import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { SESSION_TTL_DAYS } from './auth.constants.js';
import { generateToken, hashToken } from './tokens.js';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export interface ActiveSession {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
}

/**
 * Refresh-token sessions, one per signed-in device. Only token hashes are
 * stored. Expiry is computed by the database (now() + interval) so it shares
 * one clock with the CHECK and the WHERE clauses that compare against it.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(
    userId: string,
    meta: SessionMeta,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = generateToken();
    const [row]: { id: string }[] = await this.dataSource.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)
       RETURNING id`,
      [userId, hashToken(refreshToken), SESSION_TTL_DAYS, meta.userAgent?.slice(0, 512) ?? null, meta.ip ?? null],
    );
    return { sessionId: row.id, refreshToken };
  }

  /**
   * Swaps a refresh token for a new one, atomically: two requests with the
   * same token can never both succeed. Returns null for an invalid, expired,
   * revoked or already-used token.
   *
   * An already-used token is a red flag: its successor was issued, so someone
   * replaying the old one either stole it or is racing the real client. The
   * session is revoked either way, signing out whoever holds the new token.
   */
  async rotate(
    refreshToken: string,
  ): Promise<{ sessionId: string; userId: string; refreshToken: string } | null> {
    const oldHash = hashToken(refreshToken);
    const next = generateToken();

    const [rows]: [{ id: string; user_id: string }[], number] = await this.dataSource.query(
      `UPDATE sessions
       SET token_hash = $2, previous_token_hash = token_hash, last_used_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING id, user_id`,
      [oldHash, hashToken(next)],
    );
    if (rows.length > 0) {
      return { sessionId: rows[0].id, userId: rows[0].user_id, refreshToken: next };
    }

    const [reused]: [{ id: string; user_id: string }[], number] = await this.dataSource.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE previous_token_hash = $1 AND revoked_at IS NULL
       RETURNING id, user_id`,
      [oldHash],
    );
    for (const session of reused) {
      this.logger.warn(
        `Refresh token reuse: revoked session ${session.id} of user ${session.user_id}`,
      );
    }
    return null;
  }

  /** Whether an access token's session is still signed in. */
  async isActive(sessionId: string, userId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM sessions
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
      [sessionId, userId],
    );
    return rows.length > 0;
  }

  async listActive(userId: string): Promise<ActiveSession[]> {
    const rows: {
      id: string;
      user_agent: string | null;
      ip: string | null;
      created_at: Date;
      last_used_at: Date;
    }[] = await this.dataSource.query(
      `SELECT id, user_agent, host(ip) AS ip, created_at, last_used_at
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_used_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      userAgent: r.user_agent,
      ip: r.ip,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    }));
  }

  /** Sign-out of the device holding this refresh token. No-op if unknown. */
  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(refreshToken)],
    );
  }

  /** Signs out one of the user's own sessions; false if it is not theirs or already ended. */
  async revoke(sessionId: string, userId: string): Promise<boolean> {
    const [, affected]: [unknown[], number] = await this.dataSource.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [sessionId, userId],
    );
    return affected > 0;
  }

  /** Signs the user out everywhere, optionally keeping one session (the current device). */
  async revokeAll(userId: string, exceptSessionId?: string, manager?: EntityManager): Promise<void> {
    await (manager ?? this.dataSource.manager).query(
      `UPDATE sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, exceptSessionId ?? null],
    );
  }
}
