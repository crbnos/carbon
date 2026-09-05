import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getReadableIdWithRevision } from "~/utils/string";
import { solidWorksLookupValidator } from "./integrations.solidworks.models";

const logger = getLogger("erp", "integrations-solidworks-lookup");

export const config = {
  runtime: "nodejs"
};

/**
 * Return existing Carbon item replenishment settings for SolidWorks connector
 * re-sync (Make/Buy + method type), keyed by `readableIdWithRevision`.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data(
      { success: false, message: "Method not allowed" },
      { status: 405 }
    );
  }

  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = solidWorksLookupValidator.safeParse(body);
  if (!parsed.success) {
    return data(
      {
        success: false,
        message: "Invalid payload",
        errors: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const keys = [
    ...new Set(
      parsed.data.items.map((item) =>
        getReadableIdWithRevision(item.readableId, item.revision)
      )
    )
  ];

  if (keys.length === 0) {
    return data({ success: true, items: [] });
  }

  try {
    const result = await client
      .from("item")
      .select(
        "readableIdWithRevision, replenishmentSystem, defaultMethodType"
      )
      .eq("companyId", companyId)
      .in("readableIdWithRevision", keys);

    if (result.error) {
      logger.error("SolidWorks lookup: item query failed", {
        error: result.error
      });
      return data(
        { success: false, message: "Failed to look up items" },
        { status: 500 }
      );
    }

    return data({
      success: true,
      items: result.data ?? []
    });
  } catch (error) {
    logger.error("SolidWorks lookup: unexpected failure", { error });
    return data(
      { success: false, message: "Failed to look up items" },
      { status: 500 }
    );
  }
}
