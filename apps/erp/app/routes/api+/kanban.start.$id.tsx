import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { Loading } from "@carbon/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";
import { Redirect } from "~/components/Redirect";
import { getKanban } from "~/modules/inventory";
import { getActiveJobOperationByJobId } from "~/modules/production";
import { path } from "~/utils/path";

async function handleKanbanStart({
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

  let setupTime = operation.setupTime;
  let laborTime = operation.laborTime;
  let machineTime = operation.machineTime;
  let type: "Setup" | "Labor" | "Machine" = "Labor";
  if (machineTime && !laborTime) {
    type = "Machine";
  }
  if (setupTime) {
    type = "Setup";
  }

  return {
    data: path.to.external.mesJobOperationStart(operation.id, type),
    error: null
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  return await handleKanbanStart({ client, companyId, id });
}

export default function KanbanRedirectRoute() {
  const promise = useLoaderData<typeof loader>();

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Suspense fallback={<Loading className="size-8" isLoading />}>
        <Await resolve={promise}>
          {(resolvedPromise) => {
            if (resolvedPromise.error) {
              return <div>{resolvedPromise.error}</div>;
            }
            return <Redirect path={resolvedPromise?.data ?? ""} />;
          }}
        </Await>
      </Suspense>
    </div>
  );
}
