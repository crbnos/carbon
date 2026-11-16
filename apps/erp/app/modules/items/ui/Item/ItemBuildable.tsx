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
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useQuantityFormatter } from "~/hooks";
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

  const { data, isFetching, error } = useLoaderQuery<Buildable>(
    path.to.api.itemBuildable(itemId, locationId, target),
    { keepPreviousData: true }
  );

  if (error) return null;
  if (data && !data.hasMakeMethod) return null;

  const short = data?.components.filter((c) => c.quantityShort > 0) ?? [];
  const tiles = [
    {
      label: t`Can Make Now`,
      value: data?.quantityBuildable,
      hint: t`From available component stock`
    },
    {
      label: t`Using All On Hand`,
      value: data?.quantityBuildableFromOnHand,
      hint: t`If stock committed to open orders were used`
    },
    {
      label: t`Finished Goods Available`,
      value: data?.quantityAvailable,
      hint: t`On hand ${formatQuantity(data?.quantityOnHand ?? 0)}, committed ${formatQuantity(data?.quantityCommitted ?? 0)}`
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
            Through every level of the bill of materials at this location.
            Subassemblies in stock are used before they are built, and required
            quantities include each item's scrap.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent
        className={cn("flex flex-col gap-6", isFetching && "opacity-60")}
      >
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
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

        {data?.unitMismatches.length === 0 && (
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
            <Button type="submit" variant="secondary" isLoading={isFetching}>
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
