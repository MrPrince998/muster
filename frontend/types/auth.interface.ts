export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: AuthUser;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  // a page to come back to after confirming (an invite link); goes into the email's link
  next?: string;
}

/** GET /auth/sessions: a device you're signed in on. */
export interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  // the device making this request
  current: boolean;
}
