export interface User {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}
