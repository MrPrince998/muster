import { PasswordHasher } from '@nestjs/authentication';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';
import { HttpError } from '../../common/errors/http-error.js';
import { TenantService } from '../../database/tenant.service.js';
import { OrgRole } from '../organisation/entities/org-member.entity.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { normalizeEmail, User } from './entities/user.entity.js';

/** What sign-in needs: the only place the password hash is ever loaded. */
export interface SignInCandidate {
  id: string;
  // null for guest accounts, which cannot sign in
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
}

/** Whether an email is taken, and by what kind of account. */
export interface AccountStatus {
  id: string;
  // false for guest accounts (registered for an event, never signed up)
  hasPassword: boolean;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tenant: TenantService,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  /**
   * Looks up an email without loading the password hash: only whether one is
   * set. Returns null if no account uses the email.
   */
  async findAccountStatus(email: string): Promise<AccountStatus | null> {
    const row = await this.userRepository
      .createQueryBuilder('user')
      .select('user.id', 'id')
      .addSelect('user.password_hash IS NOT NULL', 'hasPassword')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getRawOne<AccountStatus>();
    return row ?? null;
  }

  // the injected repository, or the same repository inside a caller's transaction
  private repo(manager?: EntityManager): Repository<User> {
    return manager ? manager.getRepository(User) : this.userRepository;
  }

  /** Loads the password hash (select: false everywhere else) for sign-in. */
  async findSignInCandidate(email: string): Promise<SignInCandidate | null> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.emailVerifiedAt'])
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizeEmail(email) })
      .getOne();
    return user
      ? { id: user.id, passwordHash: user.passwordHash, emailVerifiedAt: user.emailVerifiedAt }
      : null;
  }

  async findPasswordHash(id: string): Promise<string | null> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .select('user.id')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
    return user?.passwordHash ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  async setPasswordHash(id: string, passwordHash: string, manager?: EntityManager): Promise<void> {
    await this.repo(manager).update({ id }, { passwordHash });
  }

  /**
   * Marks the email verified, but only if it is still the user's address: a
   * link sent to an old address must not verify a new one. Returns whether it
   * matched.
   */
  async markEmailVerified(id: string, email: string, manager?: EntityManager): Promise<boolean> {
    const result = await this.repo(manager)
      .createQueryBuilder()
      .update(User)
      .set({ emailVerifiedAt: () => 'COALESCE(email_verified_at, now())' })
      .where('id = :id AND email = :email', { id, email: normalizeEmail(email) })
      .execute();
    return Boolean(result.affected);
  }

  async recordSignIn(id: string): Promise<void> {
    await this.userRepository.update({ id }, { lastLoginAt: () => 'now()' });
  }

  /** Creates a full account. Fails with a unique violation if the email is taken. */
  createAccount(data: { email: string; name: string; passwordHash: string }): Promise<User> {
    return this.userRepository.save(this.userRepository.create(data));
  }

  /**
   * Turns a guest account into a full one by setting its password. Returns
   * null if the account already has a password, including when another
   * request claimed it a moment earlier: the WHERE makes this atomic.
   */
  async claimGuestAccount(
    id: string,
    data: { name: string; passwordHash: string },
  ): Promise<User | null> {
    const result = await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ name: data.name, passwordHash: data.passwordHash })
      .where('id = :id AND password_hash IS NULL', { id })
      .execute();
    return result.affected ? this.userRepository.findOneBy({ id }) : null;
  }

  async findOne(id: string) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw HttpError.notFound(`User #${id} not found`, 'USER_NOT_FOUND');
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.findOne(id);
    return this.userRepository.save(this.userRepository.merge(user, updateUserDto));
  }

  /**
   * Deletes an account; memberships, registrations and sessions go with it.
   * The password is checked first (INVALID_PASSWORD). Refused while the user owns a workspace: it would be left with nobody
   * able to run it, so ownership has to be handed over (or the workspace
   * deleted) first.
   */
  async removeAccount(id: string, password: string): Promise<void> {
    if (!(await this.passwordHasher.verify(password, await this.findPasswordHash(id)))) {
      throw HttpError.forbidden('Password is incorrect', 'INVALID_PASSWORD');
    }
    const owned = (await this.tenant.userOrganisations(id)).filter((o) => o.role === OrgRole.Owner);
    if (owned.length > 0) {
      throw HttpError.conflict(
        'Hand over or delete the workspaces you own before deleting your account',
        'OWNS_WORKSPACE',
        { workspaces: owned.map(({ name, slug }) => ({ name, slug })) },
      );
    }
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }
}
