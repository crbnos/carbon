import { generateDatabaseTypes } from "./lib/generate-db-types";
import { loadDotEnv } from "./lib/local-script-config";

try {
  loadDotEnv();
  generateDatabaseTypes(process.env.SUPABASE_DB_URL);
  process.stdout.write("Database types refreshed in both output files.\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Database type generation failed."}\n`
  );
  process.exitCode = 1;
}
