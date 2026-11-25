// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Button, Card, CardContent, toast } from "@carbon/react";
import { displaySerial, redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { OperationsList } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { userContext } from "~/context";
import { resolveTravelerScan } from "~/services/traveler.server";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";
import { path, TRAVELER_PARAM } from "~/utils/path";
import { readTravelerScreen, confirmedTravelerStep } from "~/utils/traveler";
import { postTravelerScan } from "~/utils/travelerScan";

export const handle: Handle = {
  realtime: ["jobOperation"]
};

export const meta: MetaFunction = () => pageMeta("Traveler");

// Read-only: a phone camera opens this page with a GET, so it never issues.
// A scanner posts to `/x/traveler/scan` instead, which claims in one scan.
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const { companyId, userId } = await authorize(request, {});
  const { locationId, effectiveUserId } = context.get(userContext) ?? {};
  const trackedEntityId = params.trackedEntityId;
  if (!trackedEntityId) return { kind: "notFound" as const };

  const screen = readTravelerScreen(new URL(request.url).searchParams);
  const resolution = await resolveTravelerScan(getCarbonServiceRole(), {
    companyId,
    locationId: locationId ?? null,
    employeeId: effectiveUserId ?? userId,
    trackedEntityId,
    at: screen.operationId
      ? {
          operationId: screen.operationId,
          trackedEntityId: screen.trackedEntityId
        }
      : undefined
  });
  if (resolution.kind === "open") {
    throw redirect(
      `${path.to.operation(resolution.operationId)}?trackedEntityId=${resolution.trackedEntityId}&${TRAVELER_PARAM}`
    );
  }
  return resolution.kind === "claim" ? { ...resolution, screen } : resolution;
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
            displaySerial(result.unit.readableId)
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
        {result.kind === "claim" && (
          <ClaimChooser
            unit={result.unit}
            options={result.options}
            auto={result.auto}
            screen={result.screen}
          />
        )}
        {result.kind === "refuse" && (
          <MesEmptyState className="h-full" title={result.message} />
        )}
      </div>
    </div>
  );
}

type LoaderResult = ReturnType<typeof useLoaderData<typeof loader>>;
type Unit = Extract<LoaderResult, { unit: unknown }>["unit"];
type ClaimOption = Extract<LoaderResult, { kind: "claim" }>["options"][number];

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

/**
 * Where a free kit or sub-assembly goes. The first option is the one a scan
 * at the operator's station takes on its own; the operator can pick another.
 * Starting posts the same scan, scoped to that operation and unit. A later
 * operation of a serial part names no unit here: it opens, the operator
 * picks the unit, then scans the part again.
 */
function ClaimChooser({
  unit,
  options,
  auto,
  screen
}: {
  unit: Unit;
  options: ClaimOption[];
  auto: boolean;
  screen: ReturnType<typeof readTravelerScreen>;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(options[0]?.operationId ?? "");
  const [pending, setPending] = useState(false);
  const selected =
    options.find((option) => option.operationId === selectedId) ?? options[0];

  const needsUnit =
    selected?.laterSerial &&
    selected.parentTrackedEntityId !== screen.trackedEntityId;
  const start = async () => {
    if (!selected) return;
    if (needsUnit) {
      navigate(path.to.operation(selected.operationId));
      return;
    }
    setPending(true);
    const result = await postTravelerScan({
      ...confirmedTravelerStep(
        screen,
        selected.operationId,
        selected.parentTrackedEntityId
      ),
      code: unit.id,
      expectedSerial: unit.readableId,
      operationId: selected.operationId,
      trackedEntityId: selected.parentTrackedEntityId
    });
    // The answer may be this same page (the unit now needs a choice).
    setPending(false);
    if (!result.href) {
      toast.error(result.message ?? t`Could not issue this unit`);
      return;
    }
    navigate(result.href);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {selected && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-sm text-muted-foreground">
              {auto ? (
                <Trans>Next up at your station</Trans>
              ) : (
                <Trans>Choose where {unit.readableId} goes</Trans>
              )}
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">
                <Trans>Scanned</Trans>
              </dt>
              <dd className="truncate font-medium">
                {displaySerial(unit.readableId)}
                {unit.itemReadableId ? ` · ${unit.itemReadableId}` : ""}
              </dd>
              <dt className="text-muted-foreground">
                <Trans>Job</Trans>
              </dt>
              <dd className="truncate">
                {selected.operation.jobReadableId}
                {selected.operation.itemReadableId
                  ? ` · ${selected.operation.itemReadableId}`
                  : ""}
              </dd>
              <dt className="text-muted-foreground">
                <Trans>Operation</Trans>
              </dt>
              <dd className="truncate">{selected.operation.description}</dd>
              {!needsUnit && (
                <>
                  <dt className="text-muted-foreground">
                    <Trans>Unit</Trans>
                  </dt>
                  <dd className="truncate font-medium">
                    {selected.parentReadableId}
                  </dd>
                </>
              )}
            </dl>
            <Button
              size="lg"
              className="self-start"
              isLoading={pending}
              isDisabled={pending}
              onClick={start}
            >
              {needsUnit ? (
                <Trans>Open the operation to pick the unit</Trans>
              ) : (
                <Trans>Start {selected.parentReadableId}</Trans>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
      {options.length > 1 && (
        <>
          <p className="text-sm text-muted-foreground">
            <Trans>Other operations that need {unit.readableId}</Trans>
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
            <OperationsList
              operations={options.map((option) => option.operation)}
              onSelect={(operation) => setSelectedId(operation.id)}
              selectedId={selected?.operationId}
            />
          </div>
        </>
      )}
    </div>
  );
}
