// Run from the repository root against an existing local database; never creates or resets it.
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local", override: true });
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("An existing local SUPABASE_DB_URL is required");
const connection = new URL(dbUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)) {
  throw new Error("An existing local SUPABASE_DB_URL is required");
}
const [command, ...args] = process.argv.slice(2);
if (!["psql", "deno", "pnpm"].includes(command ?? "")) throw new Error("Expected a local accounting verification command");
const result = spawnSync(command, args, {
  env: {
    ...process.env,
    PGHOST: connection.hostname,
    PGPORT: connection.port || "5432",
    PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password),
    PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "5"
  },
  stdio: "inherit"
});
if (result.error) throw new Error("Could not launch local accounting check");
process.exit(result.status ?? 1);
