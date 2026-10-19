import { execSync } from "node:child_process";
import path from "node:path";

/**
 * A known world before every run: the demo data, reset (backend `pnpm seed
 * --reset`). Locally that runs in the backend container; CI sets
 * SEED_COMMAND to run it directly.
 */
export default function globalSetup() {
  const command = process.env.SEED_COMMAND ?? "docker compose exec -T backend pnpm seed --reset";
  const repoRoot = path.resolve(__dirname, "../..");
  execSync(command, { cwd: repoRoot, stdio: "inherit" });
}
