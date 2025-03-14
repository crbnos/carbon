import { exec } from "child_process";
import * as dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL");
}

if (SUPABASE_URL.includes("localhost")) {
  exec(
    "npm run db:types && cp packages/database/src/types.ts packages/database/supabase/functions/lib/types.ts",
    (error, stdout, stderr) => {
      if (error) {
        console.error(`error: ${error.message}`);
        return;
      }

      if (stderr) {
        console.error(`stderr: ${stderr}`);
        return;
      }

      console.log(`stdout:\n${stdout}`);
    }
  );
}
