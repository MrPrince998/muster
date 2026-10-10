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
    expiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
  },
} as const;