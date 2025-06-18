import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse";
import * as dotenv from "dotenv";
import { createReadStream } from "fs";
import { homedir } from "os";
import { resolve } from "path";
dotenv.config();

const COMPANY_ID = "cs868u84gfk07v78v9e0";
const PROD: boolean = true;
const READ_ONLY: boolean = false;

const sourceFile = resolve(homedir(), "Desktop/black-cat-renames.csv");
const columns = ["ID", "OLD", "NEW", "REVISION"];

const parser = parse({
  delimiter: ",",
  columns,
  fromLine: 2, // Skip header row
});

const supabaseUrl = PROD
  ? process.env.PROD_SUPABASE_URL!
  : process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = PROD
  ? process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!
  : process.env.SUPABASE_SERVICE_ROLE_KEY!;

const readStream = createReadStream(sourceFile);
const client = createClient(supabaseUrl, supabaseServiceRoleKey);

(async () => {
  const company = await client
    .from("company")
    .select("name")
    .eq("id", COMPANY_ID)
    .single();

  if (company?.error) {
    console.error("Error fetching company:", company.error);
  }

  const rows: {
    ID: string;
    OLD: string;
    NEW: string;
    REVISION: string;
  }[] = [];

  readStream
    .pipe(parser)
    .on("data", (row) => {
      rows.push(row);
    })
    .on("end", async () => {
      const fetchErrors: string[] = [];
      const updateErrors: string[] = [];

      for (const row of rows) {
        console.log(`Fetching ${row.OLD.trim()}`);
        const [item, oldPart, newPart] = await Promise.all([
          client
            .from("item")
            .select("*")
            .eq("readableId", row.OLD.trim())
            .eq("companyId", COMPANY_ID)
            .single(),
          client
            .from("part")
            .select("*")
            .eq("id", row.OLD.trim())
            .eq("companyId", COMPANY_ID)
            .single(),
          client
            .from("part")
            .select("*")
            .eq("id", row.NEW.trim())
            .eq("companyId", COMPANY_ID)
            .maybeSingle(),
        ]);

        if (item.error || oldPart.error) {
          console.log(`Failed to fetch ${row.OLD.trim()}`);
          fetchErrors.push(row.OLD.trim());
          continue;
        }

        // @ts-ignore
        if (READ_ONLY === false) {
          console.log(`Updating ${row.OLD.trim()}`);

          const itemUpdate = await client
            .from("item")
            .update({
              readableId: row.NEW.trim(),
              revision: row.REVISION.trim(),
            })
            .eq("id", item.data.id)
            .eq("companyId", COMPANY_ID);

          if (itemUpdate.error) {
            console.log(`Failed to update item ${row.OLD.trim()}`);
            console.log(itemUpdate);
            updateErrors.push(row.OLD.trim());
          }

          if (newPart.data) {
            const oldPartDelete = await client
              .from("part")
              .delete()
              .eq("id", oldPart.data.id)
              .eq("companyId", COMPANY_ID);

            if (itemUpdate.error || oldPartDelete.error) {
              console.log(`Failed to update ${row.OLD.trim()}`);
              console.log(itemUpdate, oldPartDelete);
              updateErrors.push(row.OLD.trim());
            }
          } else {
            const oldPartUpdate = await client
              .from("part")
              .update({ id: row.NEW.trim() })
              .eq("id", oldPart.data.id)
              .eq("companyId", COMPANY_ID);
            if (itemUpdate.error || oldPartUpdate.error) {
              console.log(`Failed to update ${row.OLD.trim()}`);
              console.log(itemUpdate, oldPartUpdate);
              updateErrors.push(row.OLD.trim());
            }
          }
        }
      }

      if (fetchErrors.length > 0) {
        console.error("Failed to fetch the following items:");
        console.log(fetchErrors);
      }

      if (updateErrors.length > 0) {
        console.error("Failed to update the following items:");
        console.log(updateErrors);
      }
    })
    .on("error", (error) => {
      console.error("Error processing CSV:", error);
    });
})();
