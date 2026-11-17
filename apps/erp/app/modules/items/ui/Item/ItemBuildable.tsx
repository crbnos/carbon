// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Buildable } from "@carbon/planning";
import { useLoaderQuery } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";
import { Hyperlink } from "~/components";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { path } from "~/utils/path";

/**
 * How many of a made item the location can build now, and what limits it.
 * The API does the calculation; this only shows it.
 */
export default function ItemBuildable({
  itemId,
  locationId
}: {
  itemId: string;
  locationId: string;
}) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const [draft, setDraft] = useState<number>(Number.NaN);
  const [target, setTarget] = useState<number | undefined>(undefined);

  // The read in flight: the card dims and Check Quantity waits for it.
  const {
    data,
    isFetching: isLoading,
    error
  } = useLoaderQuery<Buildable>(
    path.to.api.itemBuildable(itemId, locationId, target),
    { keepPreviousData: true }
  );

  if (data && !data.hasMakeMethod) return null;
  const blocked =
    !!data && (data.unitMismatches.length > 0 || data.cycleItems.length > 0);

  const short = data?.components.filter((c) => c.quantityShort > 0) ?? [];
  const jobs = data?.jobs ?? [];
  const readyJobs = jobs.filter((job) => job.hasAllParts === true).length;
  const waitingJobs = jobs.filter((job) => job.hasAllParts === false).length;
  const tiles: { label: string; value?: number | null; hint: ReactNode }[] = [
    {
      label: t`On Hand`,
      value: data?.quantityOnHand,
      hint: t`${formatQuantity(data?.quantityAvailable ?? 0)} available, ${formatQuantity(data?.quantityCommitted ?? 0)} committed`
    },
    {
      label: t`Ready to Finish`,
      value: data?.quantityReadyToFinish,
      hint: (
        <Plural
          value={readyJobs}
          _0="No open job has every part"
          one="In production on # job with every part in stock"
          other="In production on # jobs with every part in stock"
        />
      )
    },
    {
      label: t`Waiting on Parts`,
      value: data?.quantityWaitingOnParts,
      hint: (
        <Plural
          value={waitingJobs}
          _0="No open job is short of parts"
          one="In production on # job short of parts"
          other="In production on # jobs short of parts"
        />
      )
    },
    {
      label: t`Can Start More`,
      value: data?.quantityBuildable,
      hint:
        typeof data?.quantityBuildableFromOnHand === "number"
          ? t`From stock no job or order has claimed. ${formatQuantity(data.quantityBuildableFromOnHand)} if committed stock were used`
          : t`From stock no job or order has claimed`
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Buildable Quantity</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            What is on hand at this location, which open jobs have the parts to
            finish, and what the others are short of. Starting more is checked
            through every level of the bill of materials, with each item's
            scrap.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent
        className={cn("flex flex-col gap-6", isLoading && "opacity-60")}
      >
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                {tile.label}
              </span>
              <span className="text-3xl font-medium tracking-tighter tabular-nums">
                {tile.value === undefined || tile.value === null
                  ? "–"
                  : formatQuantity(tile.value)}
              </span>
              <span className="text-xs text-muted-foreground">{tile.hint}</span>
            </div>
          ))}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>
              <Trans>Couldn't calculate the buildable quantity</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                Reload the page to try again. If it keeps failing, check this
                item's bill of materials.
              </Trans>
            </AlertDescription>
          </Alert>
        )}

        {data && data.cycleItems.length > 0 && (
          <Alert variant="warning">
            <AlertTitle>
              <Trans>The bill of materials contains itself</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                These items are on, or below, a loop in the bill of materials,
                so it can't be exploded. Remove the line that makes an item a
                component of itself.
              </Trans>
              <ul className="mt-2 list-disc pl-4">
                {data.cycleItems.map((c) => (
                  <li key={c.itemId}>{c.readableId}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {data && data.unitMismatches.length > 0 && (
          <Alert variant="warning">
            <AlertTitle>
              <Trans>Units don't match</Trans>
            </AlertTitle>
            <AlertDescription>
              <Trans>
                These bill of materials lines use a different unit than their
                item is stocked in, so they can't be compared with stock.
                Correct the line or the item's unit of measure.
              </Trans>
              <ul className="mt-2 list-disc pl-4">
                {data.unitMismatches.map((m) => (
                  <li
                    key={`${m.parentItemId}-${m.itemId}-${m.lineUnitOfMeasureCode}`}
                  >
                    <Trans>
                      {m.readableId} on {m.parentReadableId}: line in{" "}
                      {m.lineUnitOfMeasureCode}, stocked in{" "}
                      {m.stockUnitOfMeasureCode ?? "–"}
                    </Trans>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {data && data.jobShortages.length > 0 && (
          <JobShortages shortages={data.jobShortages} />
        )}

        {jobs.length > 0 && <JobsInProduction jobs={jobs} />}

        {data && !blocked && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">
              <Trans>To Start More</Trans>
            </h3>
            <p className="text-xs text-muted-foreground">
              <Trans>
                What limits new jobs, from stock no job or order has claimed.
              </Trans>
            </p>
          </div>
        )}

        {data && !blocked && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setTarget(
                Number.isInteger(draft) && draft > 0 ? draft : undefined
              );
            }}
          >
            <div className="w-32">
              <NumberField
                aria-label={t`Quantity to check`}
                value={draft}
                minValue={1}
                formatOptions={INPUT_FORMAT.quantity}
                onChange={setDraft}
              >
                <NumberInput size="sm" placeholder={t`Quantity`} />
              </NumberField>
            </div>
            <Button
              type="submit"
              variant="secondary"
              isDisabled={isLoading}
              isLoading={isLoading}
            >
              <Trans>Check Quantity</Trans>
            </Button>
            {data && (
              <span className="text-sm text-muted-foreground">
                {short.length === 0 ? (
                  <Trans>
                    Nothing is short for {formatQuantity(data.targetQuantity)}
                  </Trans>
                ) : (
                  <Trans>
                    {short.length} short for{" "}
                    {formatQuantity(data.targetQuantity)}
                  </Trans>
                )}
              </span>
            )}
          </form>
        )}

        {data && data.components.length > 0 && (
          <div className="w-full overflow-x-auto">
            <Table className="whitespace-nowrap">
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Component</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Limits To</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Per Unit</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Available</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Committed</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Required</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Scrap</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Short</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>On Order</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {data.components.map((c) => (
                  <Tr key={c.itemId}>
                    <Td>
                      <div className="flex flex-col">
                        <span className="flex items-center gap-2 font-medium">
                          {c.readableId}
                          {c.isMade && (
                            <Badge variant="secondary">
                              <Trans>Made</Trans>
                            </Badge>
                          )}
                        </span>
                        <span className="max-w-64 truncate text-xs text-muted-foreground">
                          {c.name}
                        </span>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {c.quantityBuildableAlone === null
                        ? "–"
                        : formatQuantity(c.quantityBuildableAlone)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(c.quantityPerAssembly)}{" "}
                      {c.unitOfMeasureCode}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(c.quantityAvailable)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(c.quantityCommitted)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(c.quantityRequired)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(c.quantityScrap)}
                    </Td>
                    <Td
                      className={cn(
                        "text-right tabular-nums",
                        c.quantityShort > 0 && "text-red-500 font-medium"
                      )}
                    >
                      {formatQuantity(c.quantityShort)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(c.quantityOnOrder)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** What the jobs waiting on parts lack, the item most jobs wait on first. */
function JobShortages({ shortages }: { shortages: Buildable["jobShortages"] }) {
  const formatQuantity = useQuantityFormatter();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          <Trans>Short for Jobs in Production</Trans>
        </h3>
        <p className="text-xs text-muted-foreground">
          <Trans>
            What the jobs waiting on parts still need after stock. Buy or make
            these to finish them.
          </Trans>
        </p>
      </div>
      <div className="w-full overflow-x-auto">
        <Table className="whitespace-nowrap">
          <Thead>
            <Tr>
              <Th>
                <Trans>Component</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Short</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Jobs Waiting</Trans>
              </Th>
              <Th className="text-right">
                <Trans>On Hand</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Committed</Trans>
              </Th>
              <Th className="text-right">
                <Trans>On Order</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {shortages.map((c) => (
              <Tr key={c.itemId}>
                <Td>
                  <div className="flex flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {c.readableId}
                      <Badge variant="secondary">
                        {c.isMade ? <Trans>Make</Trans> : <Trans>Buy</Trans>}
                      </Badge>
                    </span>
                    <span className="max-w-64 truncate text-xs text-muted-foreground">
                      {c.name}
                    </span>
                  </div>
                </Td>
                <Td className="text-right tabular-nums text-red-500 font-medium">
                  {formatQuantity(c.quantityShort)} {c.unitOfMeasureCode}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatQuantity(c.jobs)}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatQuantity(c.quantityOnHand)}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatQuantity(c.quantityCommitted)}
                </Td>
                <Td className="text-right tabular-nums">
                  {formatQuantity(c.quantityOnOrder)}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

/** The item's open jobs and whether stock covers what each still has to issue. */
function JobsInProduction({ jobs }: { jobs: Buildable["jobs"] }) {
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        <Trans>Jobs in Production</Trans>
      </h3>
      <div className="w-full overflow-x-auto">
        <Table className="whitespace-nowrap">
          <Thead>
            <Tr>
              <Th>
                <Trans>Job</Trans>
              </Th>
              <Th>
                <Trans>Status</Trans>
              </Th>
              <Th>
                <Trans>Due</Trans>
              </Th>
              <Th className="text-right">
                <Trans>Quantity</Trans>
              </Th>
              <Th>
                <Trans>Parts</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {jobs.map((job) => (
              <Tr key={job.id}>
                <Td>
                  <Hyperlink to={path.to.job(job.id)}>
                    {job.readableId}
                  </Hyperlink>
                </Td>
                <Td>
                  <JobStatus status={job.status} />
                </Td>
                <Td>{job.dueDate ? formatDate(job.dueDate) : "–"}</Td>
                <Td className="text-right tabular-nums">
                  {formatQuantity(job.quantityRemaining)}
                </Td>
                <Td>
                  {job.hasAllParts === null ? (
                    <Badge variant="yellow">
                      <Trans>Units don't match</Trans>
                    </Badge>
                  ) : job.hasAllParts ? (
                    <Badge variant="green">
                      <Trans>All in stock</Trans>
                    </Badge>
                  ) : (
                    <Badge variant="red">
                      <Plural
                        value={job.shortItems}
                        one="# part short"
                        other="# parts short"
                      />
                    </Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
