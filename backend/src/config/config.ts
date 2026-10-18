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

export const config = {
  env: process.env.NODE_ENV,
  port: Number(process.env.PORT),

  database: {
    url: getEnv("DATABASE_URL"),
  },

  jwt: {
    secret: getEnv("JWT_SECRET"),
    // access token lifetime; short, because refresh tokens renew it
    expiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  },

  ticket: {
    // signs the QR tickets; deliberately not JWT_SECRET, so a leaked login
    // secret can't forge tickets (and vice versa)
    secret: getEnv("TICKET_SECRET"),
  },

  // API docs at /docs; on outside production unless SWAGGER_ENABLED says otherwise
  swaggerEnabled: process.env.SWAGGER_ENABLED
    ? process.env.SWAGGER_ENABLED === "true"
    : process.env.NODE_ENV !== "production",

  // the frontend; links in emails point here
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  // the time zone event times are written in, in emails (an IANA name like
  // "Australia/Sydney"). There's no per-workspace zone yet.
  timeZone: process.env.APP_TIME_ZONE ?? "UTC",

  email: {
    // unset in development: emails are logged instead of sent
    resendApiKey:
      process.env.NODE_ENV === "production"
        ? getEnv("RESEND_API_KEY")
        : process.env.RESEND_API_KEY || undefined,
    // onboarding@resend.dev works without a verified domain, but only
    // delivers to the address that owns the Resend account
    from: process.env.EMAIL_FROM ?? "Campus Pass <onboarding@resend.dev>",
  },
} as const;