import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getUpstreamOperations } from "~/services/operations.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});
  const { operationId } = params;

  if (!operationId) throw new Error("operationId is required");

  const result = await getUpstreamOperations(client, operationId);
  return { operations: result.data ?? [] };
}
