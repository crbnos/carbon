// import type { User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const COMPANY_ID = "cs868u84gfk07v78v9e0";
const USER_ID = "7b37e09f-79f6-4a7d-b965-d92e676b3e6a";
const OPEN_JOB_STATUSES = ["Ready", "In Progress", "Paused"] as const;

console.log(process.env.SUPABASE_URL);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

(async () => {
  const { data: jobs } = await supabaseAdmin
    .from("job")
    .select("id, status")
    .eq("companyId", COMPANY_ID)
    .in("status", OPEN_JOB_STATUSES);

  if (!jobs) throw new Error("No jobs found");

  for await (const job of jobs) {
    const result = await supabaseAdmin.functions.invoke("scheduler", {
      body: {
        type: "dependencies",
        jobId: job.id,
        companyId: COMPANY_ID,
        userId: USER_ID,
      },
    });
    console.log(result);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
})();
