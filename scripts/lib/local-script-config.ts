import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

export function readLocalScriptConfig<const Keys extends readonly string[]>(
  names: Keys,
  environment: Record<string, string | undefined>
): { [Key in Keys[number]]: string } {
  const local = existsSync(".env")
    ? parseEnv(readFileSync(".env", "utf8"))
    : {};
  const values = Object.fromEntries(
    names.map((name) => [name, environment[name] ?? local[name]])
  );
  const missing = names.filter((name) => !values[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing required local configuration: ${missing.join(", ")}. Set these values in your local environment or ignored .env file.`
    );
  }
  return values as {
    [Key in Keys[number]]: string;
  };
}

export function createScriptClient(
  url: string,
  publicKey: string,
  apiKey: string
) {
  // The database workspace declares and pins this dependency; root scripts do not.
  const fromDatabase = createRequire(
    new URL("../../packages/database/package.json", import.meta.url)
  );
  const { createClient } = fromDatabase("@supabase/supabase-js");
  return createClient(url, publicKey, {
    global: { headers: { "carbon-key": apiKey } }
  });
}
