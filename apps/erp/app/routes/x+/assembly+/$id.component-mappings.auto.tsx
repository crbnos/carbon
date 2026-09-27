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

  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(null, result.error.message))
    );
  }
  const matched = result.data;

  // An explicit "match everything" gesture — also backfill every step's
  // materials from the full mapping set (additive; manual edits survive).
  // Best-effort: a failed sync still reports the mapping result.
  const materials = await syncAssemblyStepMaterialsFromMappings(client, {
    assemblyInstructionId: id,
    companyId,
    userId
  });
  const created = materials.data?.created ?? 0;

  const summary =
    matched.unmatchedBomItems.length > 0
      ? ` (${matched.unmatchedBomItems.length} BOM line${matched.unmatchedBomItems.length === 1 ? "" : "s"} unmatched: ${matched.unmatchedBomItems.slice(0, 3).join(", ")}${matched.unmatchedBomItems.length > 3 ? "…" : ""})`
      : "";
  const materialsSummary =
    created > 0
      ? ` and added ${created} step material${created === 1 ? "" : "s"}`
      : "";

  return data(
    { success: true, ...matched },
    await flash(
      request,
      success(
        `Mapped ${matched.mapped} of ${matched.totalComponents} components to the bill of materials${summary}${materialsSummary}`
      )
    )
  );
}
