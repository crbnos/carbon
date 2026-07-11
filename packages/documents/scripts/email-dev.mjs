// Starts the react-email preview server with the worktree env loaded — the
// CLI doesn't read .env files itself, and the templates need ERP_URL
// (via getAppUrl) to build asset URLs.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// loadEnvFile never overwrites existing keys — .env.local first so it wins.
for (const file of [".env.local", ".env"]) {
  const path = resolve(repoRoot, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

const [dir = "./src/email"] = process.argv.slice(2);
const result = spawnSync("email", ["dev", "--dir", dir, "--port", "3030"], {
  stdio: "inherit"
});
process.exit(result.status ?? 0);
