import fs from "node:fs";
import {
  createScriptClient,
  readLocalScriptConfig
} from "./lib/local-script-config";

const {
  CARBON_COMPANY_ID: companyId,
  CARBON_API_KEY: apiKey,
  SUPABASE_URL: carbonApiUrl,
  SUPABASE_ANON_KEY: publicApiKey,
  SALES_INVOICE_REPORT_PATH: outputPath
} = readLocalScriptConfig(
  [
    "CARBON_COMPANY_ID",
    "CARBON_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SALES_INVOICE_REPORT_PATH"
  ],
  process.env
);

const carbon = createScriptClient(carbonApiUrl, publicApiKey, apiKey);

(async () => {
  const { data, error } = await carbon
    .from("salesInvoice")
    .select(
      "*, salesInvoiceLine(*), salesInvoiceShipment(*), customer!salesInvoice_customerId_fkey(name, tags)"
    )
    .eq("companyId", companyId)
    .limit(1000)
    .order("createdAt", { ascending: false });

  if (data) {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  }

  if (error) {
    process.stderr.write("Sales invoice query failed.\n");
    process.exitCode = 1;
  }
})().catch(() => {
  process.stderr.write("Sales invoice report failed.\n");
  process.exitCode = 1;
});
