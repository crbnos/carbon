// import type { User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

// The way I was doing this was doing a SELECT name FROM storage.objects WHERE name LIKE '<companyId>%' and then exporting as JSON, and copying the results here:
// It is necessary to do one run for the public bucket and one for the private bucket. Starting with the private bucket is recommended.

const files = [
  {
    name: "crul4qo4gfk5a5f8u160/logo-dark-icon.png",
  },
  {
    name: "crul4qo4gfk5a5f8u160/logo-dark.png",
  },
  {
    name: "crul4qo4gfk5a5f8u160/logo-light-icon.png",
  },
  {
    name: "crul4qo4gfk5a5f8u160/logo-light.png",
  },
  {
    name: "crul4qo4gfk5a5f8u160/logo.png",
  },
];

console.log(process.env.SUPABASE_URL);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

(async () => {
  // Batch files into groups of 50
  const batchSize = 50;
  const fileNames = files.map((file) => file.name);
  const batches: string[][] = [];

  for (let i = 0; i < fileNames.length; i += batchSize) {
    batches.push(fileNames.slice(i, i + batchSize));
  }

  console.log(
    `Processing ${batches.length} batches of up to ${batchSize} files each`
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(
      `Processing batch ${i + 1}/${batches.length} (${batch.length} files)`
    );

    const { data, error } = await supabaseAdmin.storage
      .from("public")
      .remove(batch);

    if (error) {
      console.error(`Error in batch ${i + 1}:`, error);
      throw error;
    }

    console.log(`Successfully processed batch ${i + 1}:`, data);
  }

  console.log("All files processed successfully");
})();
