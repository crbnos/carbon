import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getJob,
  getJobMaterials,
  JobMaterialsTable,
} from "~/modules/production";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Jobs",
  to: path.to.jobs,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
    role: "employee",
  });

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const job = await getJob(client, jobId);
  if (job.error) {
    throw redirect(
      path.to.jobs,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  const materials = await getJobMaterials(client, jobId, {
    search,
    limit,
    offset,
    sorts,
    filters,
  });

  if (materials.error) {
    redirect(
      path.to.production,
      await flash(
        request,
        error(materials.error, "Failed to fetch job materials")
      )
    );
  }

  // TODO: get item inventory

  return json({
    count: materials.count ?? 0,
    materials: materials.data ?? [],
  });
}

export default function JobMaterialsRoute() {
  const { count, materials } = useLoaderData<typeof loader>();
  console.log({ materials });

  return (
    <VStack spacing={0} className="h-[calc(100vh-99px)]">
      <JobMaterialsTable data={materials} count={count} />
    </VStack>
  );
}
