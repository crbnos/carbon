import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getKanban } from "~/modules/inventory/inventory.service.server";
import { getActiveJobOperationByJobId } from "~/modules/production/production.service.server";
import { path } from "~/utils/path";

async function handleKanbanComplete({
  client,
  companyId,
  id
}: {
  client: SupabaseClient<Database>;
  companyId: string;
  id: string;
}): Promise<{ data: string; error: null } | { data: null; error: string }> {
  const kanban = await getKanban(id);
  if (kanban.error) {
    return {
      data: null,
      error: "Kanban not found"
    };
  }

  if (!kanban.data?.jobId) {
    return {
      data: null,
      error: "No job found for kanban"
    };
  }

  const operation = await getActiveJobOperationByJobId(kanban.data.jobId!);

  if (!operation) {
    return {
      data: path.to.job(kanban.data.jobId!),
      error: null
    };
  }

  return {
    data: path.to.external.mesJobOperationComplete(operation.id),
    error: null
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  const result = await handleKanbanComplete({ client, companyId, id });

  if (result.error || !result.data) {
    return data({ error: result.error }, { status: 400 });
  }

  throw redirect(result.data);
}
