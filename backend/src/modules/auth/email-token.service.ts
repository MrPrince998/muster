import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { EmailTokenPurpose } from './entities/email-token.entity.js';
import { generateToken, hashToken } from './tokens.js';

/** Single-use links sent by email (verification, password reset). */
@Injectable()
export class EmailTokenService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Creates a link token and returns the raw token (for the email only) and
   * the row id (an idempotency key for sending). Earlier unused tokens of the
   * same kind stop working: only the newest link is valid.
   */
  async issue(
    userId: string,
    purpose: EmailTokenPurpose,
    email: string,
    ttlMinutes: number,
  ): Promise<{ token: string; id: string }> {
    const token = generateToken();
    return this.dataSource.transaction(async (m) => {
      await this.invalidateAll(userId, purpose, m);
      const [row]: { id: string }[] = await m.query(
        `INSERT INTO email_tokens (user_id, purpose, token_hash, email, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
         RETURNING id`,
        [userId, purpose, hashToken(token), email, ttlMinutes],
      );
      return { token, id: row.id };
    });
  }

  /**
   * Uses a token, atomically: a link clicked twice (or twice at once) works
   * exactly once. Returns null for an unknown, expired, used or wrong-purpose
   * token.
   */
  async consume(
    token: string,
    purpose: EmailTokenPurpose,
    manager?: EntityManager,
  ): Promise<{ userId: string; email: string } | null> {
    const [rows]: [{ user_id: string; email: string }[], number] = await (
      manager ?? this.dataSource.manager
    ).query(
      `UPDATE email_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id, email`,
      [hashToken(token), purpose],
    );
    return rows[0] ? { userId: rows[0].user_id, email: rows[0].email } : null;
  }

  async invalidateAll(userId: string, purpose: EmailTokenPurpose, manager?: EntityManager): Promise<void> {
    await (manager ?? this.dataSource.manager).query(
      `UPDATE email_tokens SET used_at = now()
       WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
      [userId, purpose],
    );
  }
}
