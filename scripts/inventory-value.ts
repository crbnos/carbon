// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFileSync } from "fs";

config();

const apiUrl = "https://rest.carbon.ms";
const apiKey = "crbn_*****************";


const carbon = createClient(apiUrl, apiKey);

(async () => {
  const company = await carbon.from("company").select("id").single();
  const companyId = company.data?.id;
  if (!companyId) {
    console.error("Company not found");
    return;
  }

  const inventoryValue = await carbon.rpc("get_inventory_value_by_location", {
    company_id: companyId,
  }).csv();

  if (inventoryValue.error) {
    console.error("Error fetching inventory value:", inventoryValue.error);
    return;
  }

  const date = new Date().toISOString().split("T")[0];
  const filename = `inventory-value-${date}.csv`;
  writeFileSync(filename, inventoryValue.data);
  console.log(`Saved to ${filename}`);
})();
