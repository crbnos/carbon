import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { generateDatabaseTypes } from "./lib/generate-db-types";

try {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(file, "utf8"))
    )) {
      if (file === ".env.local" || process.env[key] === undefined)
        process.env[key] = value;
    }
  }
  generateDatabaseTypes(process.env.SUPABASE_DB_URL);
  process.stdout.write("Database types refreshed in both output files.\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Database type generation failed."}\n`
  );
  process.exitCode = 1;
}
