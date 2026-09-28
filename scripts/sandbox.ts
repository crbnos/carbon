import {
  createScriptClient,
  readLocalScriptConfig
} from "./lib/local-script-config";

const { SUPABASE_URL, SUPABASE_ANON_KEY, CARBON_API_KEY } =
  readLocalScriptConfig(
    ["SUPABASE_URL", "SUPABASE_ANON_KEY", "CARBON_API_KEY"],
    process.env
  );

const carbon = createScriptClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  CARBON_API_KEY
);

(async () => {
  const employees = await carbon.from("salesOrder").select("*").limit(1000);

  process.stdout.write(`${JSON.stringify(employees, null, 2)}\n`);
})();
