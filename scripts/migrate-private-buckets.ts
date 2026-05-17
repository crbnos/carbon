import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function migrate() {
  console.log("Starting migration of private bucket to company-specific buckets...");

  // 1. Get all companies
  const { data: companies, error: companiesError } = await supabase
    .from("company")
    .select("id");

  if (companiesError || !companies) {
    console.error("Failed to fetch companies:", companiesError);
    process.exit(1);
  }

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for await (const company of companies) {
    const companyId = company.id;
    console.log(`\nProcessing company: ${companyId}`);

    // Create the bucket if it doesn't exist
    const { error: bucketError } = await supabase.storage.createBucket(companyId, {
      public: false,
      fileSizeLimit: 52428800, // 50MB
    });

    if (bucketError && !bucketError.message.includes("already exists")) {
      console.error(`Failed to create bucket ${companyId}:`, bucketError);
      continue;
    }

    // Recursive list and copy from the legacy "private" bucket
    const listAndCopyAll = async (pathPrefix: string) => {
      const { data: list, error: listError } = await supabase.storage
        .from("private")
        .list(pathPrefix);

      if (listError || !list) {
        console.error(`Failed to list ${pathPrefix}:`, listError);
        return;
      }

      for (const item of list) {
        // Skip hidden files like .emptyFolderPlaceholder
        if (item.name.startsWith(".")) continue;

        const itemPath = pathPrefix ? `${pathPrefix}/${item.name}` : item.name;

        if (item.id === null) {
          // It's a folder, recurse
          await listAndCopyAll(itemPath);
        } else {
          // It's a file, copy it
          const { error: copyError } = await supabase.storage
            .from("private")
            .copy(itemPath, itemPath, {
              destinationBucket: companyId,
            });

          if (copyError) {
            // Skip files that already exist in the destination (idempotent)
            if (
              copyError.message?.includes("already exists") ||
              (copyError as any).statusCode === 409
            ) {
              totalSkipped++;
            } else {
              console.error(`Failed to copy ${itemPath} to ${companyId}:`, copyError);
              totalFailed++;
            }
          } else {
            console.log(`Copied: ${itemPath}`);
            totalCopied++;
          }
        }
      }
    };

    // Start recursive listing and copying at the companyId root folder in 'private' bucket
    await listAndCopyAll(companyId);
  }

  console.log("\n--- Migration Summary ---");
  console.log(`Copied:  ${totalCopied}`);
  console.log(`Skipped: ${totalSkipped} (already existed)`);
  console.log(`Failed:  ${totalFailed}`);
  console.log("Migration completed.");
}

migrate().catch(console.error);
