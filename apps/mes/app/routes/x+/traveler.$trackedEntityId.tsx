// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getLocationTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { Button, Card, CardContent, toast } from "@carbon/react";
import { datetime, redirect, resolveTrackedEntityBins } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { OperationsList } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { userContext } from "~/context";
import {
  getActiveJobOperationsByLocation,
  getMyPeopleAssignment,
  getNextIncompleteSerialEntity,
  isSerialEntityIncompleteForOperation
} from "~/services/operations.service";
import {
  getTravelerTarget,
  getUnitConsumption
} from "~/services/traveler.server";
import { makeDurations } from "~/utils/durations";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";
import { path } from "~/utils/path";
import {
  pickTravelerMaterial,
  pickTravelerOperation,
  travelerIssueCandidates
} from "~/utils/traveler";

export const handle: Handle = {
  realtime: ["jobOperation"]
};

export const meta: MetaFunction = () => pageMeta("Traveler");

const MAX_ISSUE_CANDIDATES = 10;

const log = getLogger("mes", "traveler");

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { locationId, effectiveUserId } = context.get(userContext) ?? {};
  const serviceRole = getCarbonServiceRole();

  const trackedEntityId = params.trackedEntityId;
  if (!trackedEntityId) return { kind: "notFound" as const };

  const target = await getTravelerTarget(serviceRole, {
    trackedEntityId,
    companyId
  });
  if (!target) return { kind: "notFound" as const };

  const { data: entity } = await serviceRole
    .from("trackedEntity")
    .select("id, readableId, status, itemId, attributes")
    .eq("id", target.trackedEntityId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!entity) return { kind: "notFound" as const };

  const { data: item } = entity.itemId
    ? await serviceRole
        .from("item")
        .select("readableIdWithRevision, name")
        .eq("id", entity.itemId)
        .eq("companyId", companyId)
        .maybeSingle()
    : { data: null };

  const unit = {
    id: entity.id,
    readableId: entity.readableId ?? entity.id,
    status: entity.status,
    itemReadableId: item?.readableIdWithRevision ?? null,
    itemName: item?.name ?? null
  };

  const today = locationId
    ? datetime.today(
        await getLocationTimeZone(serviceRole, locationId, companyId)
      )
    : null;

  const assignment =
    effectiveUserId && today
      ? await getMyPeopleAssignment(serviceRole, {
          companyId,
          employeeId: effectiveUserId,
          date: today.toString()
        })
      : null;
  const workCenterId = assignment?.data?.[0]?.workCenterId ?? null;

  const active = locationId
    ? await getActiveJobOperationsByLocation(serviceRole, locationId, [])
    : null;
  const rows = (active?.data ?? []).map(makeDurations);

  // A serial unit turns Available after ANY completed operation, so a unit
  // whose own make method still has open operations for it is in production.
  const ownOpen = target.jobMakeMethodId
    ? rows.filter(
        (row) =>
          row.jobMakeMethodId === target.jobMakeMethodId &&
          isSerialEntityIncompleteForOperation(entity, row.id)
      )
    : [];

  if (
    entity.status === "Reserved" ||
    (entity.status === "Available" && ownOpen.length > 0)
  ) {
    const open = rows.filter(
      (row) =>
        (!target.jobMakeMethodId ||
          row.jobMakeMethodId === target.jobMakeMethodId) &&
        isSerialEntityIncompleteForOperation(entity, row.id)
    );

    const picked = pickTravelerOperation({ operations: open, workCenterId });
    if (picked.kind === "open") {
      throw redirect(
        `${path.to.operation(picked.operationId)}?trackedEntityId=${unit.id}`
      );
    }
    if (picked.kind === "choose") {
      const ids = new Set(picked.operationIds);
      return {
        kind: "chooseOperation" as const,
        unit,
        operations: open.filter((row) => ids.has(row.id))
      };
    }
    return { kind: "info" as const, unit, storageUnitName: null };
  }

  if (entity.status === "Available") {
    const makeMethodIds = [...new Set(rows.map((row) => row.jobMakeMethodId))];
    const [materialsRead, makeMethodsRead] = await Promise.all([
      entity.itemId && makeMethodIds.length > 0
        ? serviceRole
            .from("jobMaterial")
            .select(
              "id, jobMakeMethodId, jobOperationId, quantity, estimatedQuantity, quantityIssued"
            )
            .eq("itemId", entity.itemId)
            .in("jobMakeMethodId", makeMethodIds)
            .eq("companyId", companyId)
        : Promise.resolve({ data: [], error: null }),
      makeMethodIds.length > 0
        ? serviceRole
            .from("jobMakeMethod")
            .select("id, requiresSerialTracking")
            .in("id", makeMethodIds)
            .eq("companyId", companyId)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (materialsRead.error || makeMethodsRead.error) {
      log.error("Could not read the job materials for a traveler", {
        companyId,
        trackedEntityId: entity.id,
        error: materialsRead.error ?? makeMethodsRead.error
      });
    }
    const materials = (materialsRead.data ?? []).flatMap((material) =>
      material.jobMakeMethodId
        ? [{ ...material, jobMakeMethodId: material.jobMakeMethodId }]
        : []
    );
    // A serial make method is checked per unit below, once its unit is known.
    const serialMakeMethodIds = new Set(
      (makeMethodsRead.data ?? [])
        .filter((method) => method.requiresSerialTracking)
        .map((method) => method.id)
    );

    const candidateIds = travelerIssueCandidates({
      operations: rows,
      materials,
      workCenterId,
      perUnitMakeMethodIds: serialMakeMethodIds
    });

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const candidateOperations = candidateIds.map((id) => rowsById.get(id)!);
    const candidateMakeMethodIds = [
      ...new Set(candidateOperations.map((row) => row.jobMakeMethodId))
    ];

    // Two reads for every candidate, as getTrackedEntitiesForOperation does
    // for one: the units of each make method in unit-axis order, and the
    // rework scope rows of each operation.
    const [units, scope] =
      candidateOperations.length > 0
        ? await Promise.all([
            serviceRole
              .from("trackedEntity")
              .select("*")
              .in("attributes->>Job Make Method", candidateMakeMethodIds)
              .eq("companyId", companyId)
              .order("createdAt", { ascending: true })
              .order("readableId", { ascending: true })
              .order("id", { ascending: true }),
            serviceRole
              .from("jobOperationTrackedEntity")
              .select("jobOperationId, trackedEntityId")
              .in("jobOperationId", candidateIds)
              .eq("companyId", companyId)
          ])
        : [{ data: [] }, { data: [] }];

    const unitsByMakeMethod = new Map<
      string,
      Database["public"]["Tables"]["trackedEntity"]["Row"][]
    >();
    for (const row of units.data ?? []) {
      const makeMethodId = ((row.attributes ?? {}) as Record<string, unknown>)[
        "Job Make Method"
      ];
      if (typeof makeMethodId !== "string") continue;
      const group = unitsByMakeMethod.get(makeMethodId) ?? [];
      group.push(row);
      unitsByMakeMethod.set(makeMethodId, group);
    }

    const scopeByOperation = new Map<string, Set<string>>();
    for (const row of scope.data ?? []) {
      const ids = scopeByOperation.get(row.jobOperationId) ?? new Set();
      ids.add(row.trackedEntityId);
      scopeByOperation.set(row.jobOperationId, ids);
    }

    const withParents = candidateOperations.flatMap((operation) => {
      const scopedIds = scopeByOperation.get(operation.id) ?? null;
      const parent = getNextIncompleteSerialEntity(
        (unitsByMakeMethod.get(operation.jobMakeMethodId) ?? []).map(
          (entity) => ({
            ...entity,
            inOperationScope: scopedIds ? scopedIds.has(entity.id) : true
          })
        ),
        operation.id
      );
      return parent ? [{ operation, parentTrackedEntityId: parent.id }] : [];
    });

    // The issue route's rule (`resolveTravelerMaterial`): a serial unit that
    // already has the item is no candidate. A failed read keeps the
    // candidate; the issue route still refuses it.
    const serialParentIds = withParents
      .filter((candidate) =>
        serialMakeMethodIds.has(candidate.operation.jobMakeMethodId)
      )
      .map((candidate) => candidate.parentTrackedEntityId);
    const consumption = await getUnitConsumption(serviceRole, {
      companyId,
      unitIds: serialParentIds
    });
    const consumed = consumption.data;
    const candidates = (
      consumed
        ? withParents.filter((candidate) => {
            const isSerial = serialMakeMethodIds.has(
              candidate.operation.jobMakeMethodId
            );
            const picked = pickTravelerMaterial({
              materials: materials.filter(
                (material) =>
                  material.jobMakeMethodId ===
                  candidate.operation.jobMakeMethodId
              ),
              jobOperationId: candidate.operation.id,
              unitConsumed: isSerial
                ? (consumed.get(candidate.parentTrackedEntityId) ??
                  new Map<string, number>())
                : null
            });
            return picked.kind === "issue";
          })
        : withParents
    ).slice(0, MAX_ISSUE_CANDIDATES);

    if (candidates.length === 0) {
      const { data: ledgers } = await serviceRole
        .from("itemLedger")
        .select("trackedEntityId, storageUnitId, quantity")
        .eq("trackedEntityId", entity.id)
        .eq("companyId", companyId);
      const storageUnitId =
        resolveTrackedEntityBins(ledgers ?? []).get(entity.id)?.storageUnitId ??
        null;
      const { data: storageUnit } = storageUnitId
        ? await serviceRole
            .from("storageUnit")
            .select("name")
            .eq("id", storageUnitId)
            .eq("companyId", companyId)
            .maybeSingle()
        : { data: null };
      return {
        kind: "info" as const,
        unit,
        storageUnitName: storageUnit?.name ?? null
      };
    }

    return { kind: "chooseIssue" as const, unit, candidates };
  }

  return { kind: "status" as const, unit };
}

export default function TravelerRoute() {
  const { t } = useLingui();
  const result = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Traveler</Trans>} />
      <MesQueueHeader
        title={
          result.kind === "notFound" ? (
            <Trans>Traveler</Trans>
          ) : (
            result.unit.readableId
          )
        }
      />

      <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        {result.kind === "notFound" && (
          <MesEmptyState
            className="h-full"
            title={t`This label does not belong to a unit in this company`}
          />
        )}
        {result.kind === "status" && (
          <MesEmptyState
            className="h-full"
            title={t`${result.unit.readableId} is ${result.unit.status}`}
          />
        )}
        {result.kind === "info" && (
          <UnitInfo
            unit={result.unit}
            storageUnitName={result.storageUnitName}
          />
        )}
        {result.kind === "chooseOperation" && (
          <>
            <p className="px-4 pt-4 text-sm text-muted-foreground">
              <Trans>Choose the operation to open for this unit</Trans>
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4 max-md:pt-3">
              <OperationsList
                operations={result.operations}
                getHref={(operation) =>
                  `${path.to.operation(operation.id)}?trackedEntityId=${result.unit.id}`
                }
              />
            </div>
          </>
        )}
        {result.kind === "chooseIssue" && (
          <IssueChooser unit={result.unit} candidates={result.candidates} />
        )}
      </div>
    </div>
  );
}

type LoaderResult = ReturnType<typeof useLoaderData<typeof loader>>;
type Unit = Extract<LoaderResult, { unit: unknown }>["unit"];
type Candidate = Extract<
  LoaderResult,
  { kind: "chooseIssue" }
>["candidates"][number];

function UnitInfo({
  unit,
  storageUnitName
}: {
  unit: Unit;
  storageUnitName: string | null;
}) {
  return (
    <div className="p-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">
              <Trans>Unit</Trans>
            </dt>
            <dd className="truncate font-medium">{unit.readableId}</dd>
            <dt className="text-muted-foreground">
              <Trans>Item</Trans>
            </dt>
            <dd className="truncate">
              {unit.itemReadableId ?? "–"}
              {unit.itemName ? ` · ${unit.itemName}` : ""}
            </dd>
            <dt className="text-muted-foreground">
              <Trans>Status</Trans>
            </dt>
            <dd className="truncate">{unit.status}</dd>
            <dt className="text-muted-foreground">
              <Trans>Storage Unit</Trans>
            </dt>
            <dd className="truncate">{storageUnitName ?? "–"}</dd>
          </dl>
          <Button
            asChild
            size="lg"
            variant="secondary"
            rightIcon={<LuExternalLink />}
            className="self-start"
          >
            <a
              href={path.to.erpTraceability(unit.id)}
              target="_blank"
              rel="noreferrer"
            >
              <Trans>View Traceability</Trans>
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function IssueChooser({
  unit,
  candidates
}: {
  unit: Unit;
  candidates: Candidate[];
}) {
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(
    candidates[0]?.operation.id ?? ""
  );
  const selected =
    candidates.find((candidate) => candidate.operation.id === selectedId) ??
    candidates[0];

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per issue response
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || !selected) return;
    if (fetcher.data.success) {
      navigate(
        `${path.to.operation(selected.operation.id)}?trackedEntityId=${selected.parentTrackedEntityId}`
      );
    } else if (fetcher.data.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data, fetcher.state]);

  const issue = () => {
    if (!selected) return;
    fetcher.submit(
      JSON.stringify({
        travelerScan: true,
        jobOperationId: selected.operation.id,
        parentTrackedEntityId: selected.parentTrackedEntityId,
        children: [{ trackedEntityId: unit.id, quantity: 1 }]
      }),
      {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      }
    );
  };

  return (
    <>
      <p className="px-4 pt-4 text-sm text-muted-foreground">
        <Trans>Choose the operation to issue {unit.readableId} into</Trans>
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] p-4 gap-4 max-md:pt-3">
        <OperationsList
          operations={candidates.map((candidate) => candidate.operation)}
          onSelect={(operation) => setSelectedId(operation.id)}
          selectedId={selected?.operation.id}
        />
      </div>
      {selected && (
        <div className="px-4 pb-4">
          <Button
            size="lg"
            isLoading={fetcher.state !== "idle"}
            isDisabled={fetcher.state !== "idle"}
            onClick={issue}
          >
            <Trans>Issue to {selected.operation.jobReadableId}</Trans>
          </Button>
        </div>
      )}
    </>
  );
}
