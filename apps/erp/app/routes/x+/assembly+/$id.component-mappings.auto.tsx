import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  autoMatchAssemblyComponents,
  syncAssemblyStepMaterialsFromMappings
} from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await autoMatchAssemblyComponents(client, {
    assemblyInstructionId: id,
    companyId,
    userId
  });

  if ("error" in result) {
    return data(
      { success: false },
      await flash(request, error(null, result.error))
    );
  }

  // An explicit "match everything" gesture — also backfill every step's
  // materials from the full mapping set (additive; manual edits survive).
  const materials = await syncAssemblyStepMaterialsFromMappings(client, {
    assemblyInstructionId: id,
    companyId,
    userId
  });

  const summary =
    result.unmatchedBomItems.length > 0
      ? ` (${result.unmatchedBomItems.length} BOM line${result.unmatchedBomItems.length === 1 ? "" : "s"} unmatched: ${result.unmatchedBomItems.slice(0, 3).join(", ")}${result.unmatchedBomItems.length > 3 ? "…" : ""})`
      : "";
  const materialsSummary =
    materials.created > 0
      ? ` and added ${materials.created} step material${materials.created === 1 ? "" : "s"}`
      : "";

  return data(
    { success: true, ...result },
    await flash(
      request,
      success(
        `Mapped ${result.mapped} of ${result.totalComponents} components to the bill of materials${summary}${materialsSummary}`
      )
    )
  );
}
