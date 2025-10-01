import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { Loading } from "@carbon/react";
import { Await, useLoaderData } from "@remix-run/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defer, type LoaderFunctionArgs } from "@vercel/remix";
import { Suspense } from "react";
import { Redirect } from "~/components/Redirect";
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

  return defer(await handleKanbanComplete({ client, companyId, id }));
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
