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

const [dir = "./src/email/previews"] = process.argv.slice(2);
const port = process.env.EMAIL_DEV_PORT || "3030";

const result = spawnSync("email", ["dev", "--dir", dir, "--port", port], {
  stdio: "inherit"
});
// spawnSync reports launch failures (e.g. binary missing) via result.error
// with status null — without this check the script exits 0 printing nothing.
if (result.error) {
  console.error(`Failed to start react-email preview server: ${result.error.message}`);
  if (result.error.code === "ENOENT") {
    console.error(
      "The `email` binary was not found. Run `pnpm install`, then start via `pnpm --filter @carbon/documents email` so node_modules/.bin is on PATH."
    );
  }
  process.exit(1);
}
process.exit(result.status ?? 0);
