import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { getKanban } from "~/modules/inventory";
import { getActiveJobOperationByJobId } from "~/modules/production";
import { path } from "~/utils/path";

const logger = getLogger("erp", "kanban-complete");

async function handleKanbanComplete({
  client,
  companyId,
  id
}: {
  client: SupabaseClient<Database>;
  companyId: string;
  id: string;
}): Promise<{ data: string; error: null } | { data: null; error: string }> {
  const kanban = await getKanban(client, id, companyId);
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

  const activeOperation = await getActiveJobOperationByJobId(
    client,
    kanban.data.jobId!,
    companyId
  );
  // A failed read falls back to the job page, as "no active operation" does.
  if (activeOperation.error) {
    logger.error("Failed to load the job's active operation", {
      jobId: kanban.data.jobId,
      error: activeOperation.error
    });
  }
  const operation = activeOperation.data;

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
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const result = await handleKanbanComplete({ client, companyId, id });

  if (result.error || !result.data) {
    return data({ error: result.error }, { status: 400 });
  }

  throw redirect(result.data);
}
