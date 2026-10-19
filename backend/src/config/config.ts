import dotenv from "dotenv";

// load environment variables from .env file
dotenv.config();

function getEnv(key:string):string {
  const value = process.env[key];

  if(!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

const production = process.env.NODE_ENV === "production";

// A secret that signs tokens: in production it must be long and not the
// example's placeholder, or anyone could forge sign-ins (JWT_SECRET) or
// tickets (TICKET_SECRET). Generate one with: openssl rand -base64 48
function getSecret(key: string): string {
  const value = getEnv(key);
  if (production && (value.length < 32 || /change-?me/i.test(value))) {
    throw new Error(`${key} must be at least 32 random characters in production`);
  }
  return value;
}

// How many proxies sit in front of the API (a load balancer, Caddy, ...).
// Behind one, every request seems to come from the proxy, so rate limits
// would count all users together; trusting it makes them per client again.
// Unset or 0: no proxy, trust nothing.
// Rate limits off: only for automated browser tests, which sign in and
// reload far faster than a person. Never in production.
function throttleDisabled(): boolean {
  const off = process.env.THROTTLE_DISABLED === "true";
  if (off && production) throw new Error("THROTTLE_DISABLED can't be used in production");
  return off;
}

function trustProxy(): number {
  const hops = Number(process.env.TRUST_PROXY ?? 0);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error("TRUST_PROXY must be a whole number of proxies (0 for none)");
  }
  return hops;
}

export const config = {
  env: process.env.NODE_ENV,
  port: Number(process.env.PORT),
  trustProxy: trustProxy(),
  throttleDisabled: throttleDisabled(),

  database: {
    url: getEnv("DATABASE_URL"),
  },

  jwt: {
    secret: getSecret("JWT_SECRET"),
    // access token lifetime; short, because refresh tokens renew it
    expiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  },

  ticket: {
    // signs the QR tickets; deliberately not JWT_SECRET, so a leaked login
    // secret can't forge tickets (and vice versa)
    secret: getSecret("TICKET_SECRET"),
  },

  // API docs at /docs; on outside production unless SWAGGER_ENABLED says otherwise
  swaggerEnabled: process.env.SWAGGER_ENABLED
    ? process.env.SWAGGER_ENABLED === "true"
    : process.env.NODE_ENV !== "production",

  // the frontend; links in emails point here
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  // the day-before reminder emails; REMINDERS_ENABLED=false turns them off
  reminders: {
    enabled: process.env.REMINDERS_ENABLED !== "false",
  },

  // the time zone event times are written in, in emails (an IANA name like
  // "Australia/Sydney"). There's no per-workspace zone yet.
  timeZone: process.env.APP_TIME_ZONE ?? "UTC",

  email: {
    // unset in development: emails are logged instead of sent
    resendApiKey:
      production
        ? getEnv("RESEND_API_KEY")
        : process.env.RESEND_API_KEY || undefined,
    // onboarding@resend.dev works without a verified domain, but only
    // delivers to the address that owns the Resend account
    from: process.env.EMAIL_FROM ?? "Muster <onboarding@resend.dev>",
  },
} as const;