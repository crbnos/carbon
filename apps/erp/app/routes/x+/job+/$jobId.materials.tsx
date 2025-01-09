import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useMount, VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { usePanels } from "~/components/Layout";
import {
  getJob,
  getJobMaterialsWithQuantityOnHand,
} from "~/modules/production";
import { JobMaterialsTable } from "~/modules/production/ui/Jobs";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

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

  const materials = await getJobMaterialsWithQuantityOnHand(client, jobId, {
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

  return json({
    count: materials.count ?? 0,
    materials: materials.data ?? [],
  });
}

export default function JobMaterialsRoute() {
  const { count, materials } = useLoaderData<typeof loader>();
  const { setIsExplorerCollapsed } = usePanels();

  useMount(() => {
    setIsExplorerCollapsed(true);
  });

  return (
    <VStack spacing={0} className="h-[calc(100dvh-99px)]">
      <JobMaterialsTable data={materials} count={count} />
    </VStack>
  );
}
