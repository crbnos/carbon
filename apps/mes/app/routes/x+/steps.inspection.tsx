import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

const logger = getLogger("mes", "steps-inspection");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});

  const payload = await request.json();
  let insertedSteps: Database["public"]["Tables"]["jobOperationStep"]["Insert"][] =
    [];
  if (Array.isArray(payload)) {
    // Rows are rebuilt from the fields the client is allowed to set (tenant and
    // audit columns come from the session), since the insert is service-role.
    insertedSteps = payload
      .filter((step) => step?.companyId === companyId)
      .map((step) => ({
        companyId,
        createdBy: userId,
        operationId: String(step.operationId ?? ""),
        name: String(step.name ?? ""),
        type: "Inspection" as const,
        ...(typeof step.sortOrder === "number"
          ? { sortOrder: step.sortOrder }
          : {}),
        nonConformanceActionId: step.nonConformanceActionId
          ? String(step.nonConformanceActionId)
          : null
      }));
    if (insertedSteps.length > 0) {
      const serviceRole = await getCarbonServiceRole();

      // The operation and action ids come from the request body: verify each
      // belongs to this company, one scoped query per id type.
      const operationIds = [
        ...new Set(insertedSteps.map((step) => step.operationId))
      ];
      const actionIds = [
        ...new Set(
          insertedSteps
            .map((step) => step.nonConformanceActionId)
            .filter((id): id is string => Boolean(id))
        )
      ];
      const [operations, actions] = await Promise.all([
        serviceRole
          .from("jobOperation")
          .select("id")
          .in("id", operationIds)
          .eq("companyId", companyId),
        actionIds.length
          ? serviceRole
              .from("nonConformanceActionTask")
              .select("id")
              .in("id", actionIds)
              .eq("companyId", companyId)
          : { data: [], error: null }
      ]);
      if (
        operations.error ||
        actions.error ||
        (operations.data ?? []).length !== operationIds.length ||
        (actions.data ?? []).length !== actionIds.length
      ) {
        logger.warn("Inspection steps reference records outside the company", {
          companyId,
          operationIds,
          actionIds,
          error: operations.error ?? actions.error
        });
        return data(
          { success: false, message: "Operation not found" },
          { status: 404 }
        );
      }

      const result = await serviceRole
        .from("jobOperationStep")
        .insert(insertedSteps);
      if (result.error) {
        return data(
          { success: false, message: result.error.message },
          { status: 400 }
        );
      }

      return { success: true };
    } else {
      return { success: true };
    }
  } else {
    return data(
      { success: false, message: "Payload is not an array" },
      { status: 400 }
    );
  }
}
