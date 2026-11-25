// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getSupplierParts } from "~/modules/items/items.service";

const logger = getLogger("erp", "planning-supplier-parts");

const planningSupplierPartsQueryValidator = z.object({
  itemId: z.string().min(1)
});

// The purchasing planning drawer's Suppliers tab, read again after a supplier
// is added there: the item's active supplier parts, as the planning grid's
// row lists them. Read as the caller, so RLS applies (purchasing view reads
// supplier parts).
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const parsed = planningSupplierPartsQueryValidator.safeParse({
    itemId: search.get("itemId")
  });
  if (!parsed.success) {
    logger.warning("Planning supplier parts read refused: bad query", {
      issues: parsed.error.issues
    });
    throw data({ error: "itemId is required" }, { status: 400 });
  }
  const { itemId } = parsed.data;

  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const suppliers = await getSupplierParts(client, itemId, companyId);
  if (suppliers.error) {
    logger.error("Failed to read the item's supplier parts", {
      itemId,
      error: suppliers.error
    });
    throw data({ error: "Failed to load the suppliers" }, { status: 500 });
  }

  return { suppliers: suppliers.data };
}

export const clientLoader = cachedClientLoader<typeof loader>();
