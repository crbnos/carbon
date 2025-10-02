import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { getKanban } from "~/modules/inventory";
import { getActiveJobOperationByJobId } from "~/modules/production";
import { path } from "~/utils/path";

async function handleKanbanComplete({
  client,
  companyId,
  id,
}: {
  client: SupabaseClient<Database>;
  companyId: string;
  id: string;
}): Promise<{ data: string; error: null } | { data: null; error: string }> {
  const kanban = await getKanban(client, id);
  if (kanban.error) {
    return {
      data: null,
      error: "Kanban not found",
    };
  }

  if (!kanban.data?.jobId) {
    return {
      data: null,
      error: "No job found for kanban",
    };
  }

  const operation = await getActiveJobOperationByJobId(
    client,
    kanban.data.jobId!,
    companyId
  );

  if (!operation) {
    return {
      data: path.to.job(kanban.data.jobId!),
      error: null,
    };
  }

  return {
    data: path.to.external.mesJobOperationComplete(operation.id),
    error: null,
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  const result = await handleKanbanComplete({ client, companyId, id });

  if (result.error || !result.data) {
    return json({ error: result.error }, { status: 400 });
  }

  throw redirect(result.data);
}
