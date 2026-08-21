import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getBatchableOperations,
  getBatchableProcesses
} from "~/modules/production";
import { BatchingBoard } from "~/modules/production/ui/Schedule/Batching/BatchingBoard";
import type {
  BatchCandidate,
  BatchLaneData,
  BatchMaterial
} from "~/modules/production/ui/Schedule/Batching/types";
import {
  getLocationsList,
  getWorkCentersByLocation
} from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Schedule`,
  to: path.to.scheduleBatching,
  module: "schedule"
};

const FACET_KEYS = [
  "formId",
  "substanceId",
  "gradeId",
  "dimensionId",
  "finishId"
] as const;
type FacetKey = (typeof FACET_KEYS)[number];

const FACET_NAME: Record<FacetKey, keyof BatchMaterial> = {
  formId: "formName",
  substanceId: "substanceName",
  gradeId: "gradeName",
  dimensionId: "dimensionName",
  finishId: "finishName"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const search = searchParams.get("search")?.toLowerCase() ?? "";
  const processId = searchParams.get("process");

  // Active facet filters, parsed from the shared ?filter=key:op:value grammar.
  const activeFacets: Partial<Record<FacetKey, string[]>> = {};
  for (const filter of searchParams.getAll("filter")) {
    const [key, operator, value] = filter.split(":");
    if ((FACET_KEYS as readonly string[]).includes(key)) {
      activeFacets[key as FacetKey] =
        operator === "in" ? value.split(",") : [value];
    }
  }

  let locationId = searchParams.get("location");
  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    locationId = userDefaults.data?.locationId ?? null;
  }
  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data[0].id as string;
  }

  const [processes, workCenters] = await Promise.all([
    getBatchableProcesses(client, companyId),
    getWorkCentersByLocation(client, locationId)
  ]);

  if (!processId) {
    return {
      locationId,
      processId: null,
      processes: processes.data ?? [],
      workCenters: workCenters.data ?? [],
      candidates: [] as BatchCandidate[],
      batches: [] as BatchLaneData[],
      facetOptions: {} as Record<FacetKey, { id: string; name: string }[]>
    };
  }

  const operations = await getBatchableOperations(client, {
    locationId,
    processId
  });
  const rows = (operations.data ?? []) as unknown as BatchCandidate[];

  // Partition: unbatched candidates vs Active batch members.
  const rawCandidates = rows.filter((r) => !r.jobOperationBatchId);
  const batchMap = new Map<string, BatchLaneData>();
  for (const r of rows) {
    if (!r.jobOperationBatchId) continue;
    let lane = batchMap.get(r.jobOperationBatchId);
    if (!lane) {
      lane = {
        id: r.jobOperationBatchId,
        readableId: r.batchReadableId ?? "Batch",
        // The RPC only returns Active + Completing batches; anything else is
        // treated as Active for the board.
        status: r.batchStatus === "Completing" ? "Completing" : "Active",
        workCenterId: r.batchWorkCenterId,
        members: []
      };
      batchMap.set(r.jobOperationBatchId, lane);
    }
    lane.members.push(r);
  }

  // Facet options from the DISTINCT material properties of the unfiltered candidates.
  const facetOptions = Object.fromEntries(
    FACET_KEYS.map((key) => {
      const nameKey = FACET_NAME[key];
      const seen = new Map<string, string>();
      for (const c of rawCandidates) {
        for (const m of c.materials ?? []) {
          const id = m[key] as string | null;
          const name = m[nameKey] as string | null;
          if (id && name && !seen.has(id)) seen.set(id, name);
        }
      }
      return [
        key,
        [...seen.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      ];
    })
  ) as Record<FacetKey, { id: string; name: string }[]>;

  // A candidate matches if ANY BOM line satisfies ALL active facets; search
  // matches job/item readable ids + descriptions.
  const candidates = rawCandidates.filter((c) => {
    const facetEntries = Object.entries(activeFacets) as [FacetKey, string[]][];
    if (facetEntries.length > 0) {
      const anyLineMatches = (c.materials ?? []).some((m) =>
        facetEntries.every(([key, values]) => values.includes(m[key] as string))
      );
      if (!anyLineMatches) return false;
    }
    if (search) {
      const haystack = [
        c.jobReadableId,
        c.itemReadableId,
        c.itemDescription,
        c.description
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  return {
    locationId,
    processId,
    processes: processes.data ?? [],
    workCenters: workCenters.data ?? [],
    candidates,
    batches: [...batchMap.values()],
    facetOptions
  };
}

export default function BatchingRoute() {
  const loaderData = useLoaderData<typeof loader>();
  return <BatchingBoard {...loaderData} />;
}
