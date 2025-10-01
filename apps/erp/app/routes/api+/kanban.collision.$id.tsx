import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button, Heading } from "@carbon/react";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { LuTriangleAlert } from "react-icons/lu";

import { getKanban } from "~/modules/inventory";
import {
  getJob,
  updateKanbanJob,
} from "~/modules/production/production.service";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id);
  if (
    kanban.data?.replenishmentSystem !== "Make" ||
    !kanban.data?.jobReadableId
  ) {
    // false alarm, this is not a collision
    throw redirect(path.to.api.kanban(id));
  }

  const job = await getJob(client, kanban.data.jobId!);
  if (job.error) {
    return json({
      existingJob: null,
      id,
    });
  }

  return json({
    existingJob: job.data,
    id,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanbanUpdate = await updateKanbanJob(client, {
    id,
    jobId: null,
    userId,
    companyId,
  });

  if (kanbanUpdate.error) {
    return json(
      { success: false },
      await flash(request, error("Failed to cancel job"))
    );
  }

  return redirect(
    path.to.api.kanban(id),
    await flash(request, success("Job cancelled"))
  );
}

export default function KanbanCollisionRoute() {
  const { id, existingJob } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  if (!existingJob) return null;

  return (
    <div className="flex flex-col gap-2 h-screen w-screen items-center justify-center">
      <LuTriangleAlert className="size-12 text-muted-foreground" />
      <Heading size="display">{existingJob?.jobId}</Heading>
      {/* <JobStatus status={existingJob?.status} /> */}
      <p className="text-lg text-muted-foreground max-w-md text-center mx-auto">
        There's already a job for this kanban.
      </p>
      <div className="flex gap-2 py-4">
        <Button size="lg" variant="secondary" asChild>
          <Link to={path.to.api.kanbanJobLink(id)}>View Job</Link>
        </Button>
        <fetcher.Form method="post">
          <Button
            isLoading={fetcher.state !== "idle"}
            isDisabled={fetcher.state !== "idle"}
            variant="destructive"
            size="lg"
            type="submit"
          >
            Remove Job
          </Button>
        </fetcher.Form>
      </div>
    </div>
  );
}
