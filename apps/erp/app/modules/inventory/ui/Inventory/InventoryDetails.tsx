// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { LuMoveDown, LuMoveUp } from "react-icons/lu";
import type { z } from "zod";
import { DateSelect } from "~/components/DateSelect";
import { useQuantityFormatter } from "~/hooks";
import type {
  ItemQuantities,
  ItemStorageUnitQuantities,
  itemTrackingTypes,
  pickMethodValidator
} from "~/modules/items";
import InventoryStorageUnits from "./InventoryStorageUnits";

type InventoryDetailsProps = {
  itemStorageUnitQuantities: ItemStorageUnitQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  itemShelfLife: {
    mode: string | null;
    days: number | null;
  } | null;
  trackedEntityExpirations: Record<string, string | null>;
  pickMethod: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities | null;
  storageUnits: { value: string; label: string }[];
  /**
   * The inventory quantities page. Phones show tiles and rows there; the
   * item pages' inventory tabs stay as they are.
   */
  variant?: "quantity";
};

const InventoryDetails = ({
  itemStorageUnitQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  itemShelfLife,
  trackedEntityExpirations,
  pickMethod,
  quantities,
  storageUnits,
  variant
}: InventoryDetailsProps) => {
  const isQuantity = variant === "quantity";
  const formatQuantity = useQuantityFormatter();
  const [usageWindow, setUsageWindow] = useState<"30" | "90">("30");
  const dailyUsage =
    usageWindow === "30"
      ? (quantities?.usageLast30Days ?? 0)
      : (quantities?.usageLast90Days ?? 0);

  const renderUsageWindowSelect = (className?: string) => (
    <DateSelect
      className={className}
      value={usageWindow}
      onValueChange={(v) => {
        if (v === "30" || v === "90") setUsageWindow(v);
      }}
      options={[
        { value: "30", label: "30D" },
        { value: "90", label: "90D" }
      ]}
      showCustom={false}
    />
  );

  // Quantities page, phones: the figures as 2-column tiles (MetricCard sizes).
  const valueClassName = cn(
    "text-4xl font-medium tracking-tighter",
    isQuantity &&
      "max-md:truncate max-md:text-[26px] max-md:font-semibold max-md:tracking-tight max-md:tabular-nums"
  );

  return (
    <VStack>
      {isQuantity ? (
        <div className="flex items-center gap-2 md:hidden">
          <span className="text-sm text-muted-foreground">
            <Trans>Daily usage</Trans>
          </span>
          {renderUsageWindowSelect()}
        </div>
      ) : null}
      <div
        className={cn(
          "w-full grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-2",
          isQuantity && "max-md:grid-cols-2 max-md:gap-3"
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Quantity on Hand</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className={valueClassName}>
              {formatQuantity(quantities?.quantityOnHand ?? 0)}
            </h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Days Remaining</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className={valueClassName}>
              {formatQuantity(quantities?.daysRemaining ?? 0)}
            </h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>
              <Trans>Daily Usage</Trans>
            </CardTitle>
            {/* Quantities page, phones: the select sits above the tiles. */}
            {renderUsageWindowSelect(isQuantity ? "max-md:hidden" : undefined)}
          </CardHeader>
          <CardContent>
            <h3 className={valueClassName}>{formatQuantity(dailyUsage)}</h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Quantity on Purchase Order</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-start items-center gap-1">
              <h3 className={valueClassName}>
                {formatQuantity(quantities?.quantityOnPurchaseOrder ?? 0)}
              </h3>
              <LuMoveUp className="text-emerald-500 text-lg" />
            </div>
            {isQuantity ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground md:hidden">
                <LuMoveUp className="text-emerald-500" />
                <Trans>Incoming</Trans>
              </span>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Quantity on Sales Order</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-start items-center gap-1">
              <h3 className={valueClassName}>
                {formatQuantity(quantities?.quantityOnSalesOrder ?? 0)}
              </h3>
              <LuMoveDown className="text-red-500 text-lg" />
            </div>
            {isQuantity ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground md:hidden">
                <LuMoveDown className="text-red-500" />
                <Trans>Outgoing</Trans>
              </span>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Quantity on Jobs</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-start gap-2">
              <div className="flex justify-start items-center gap-1">
                <h3 className={valueClassName}>
                  {formatQuantity(quantities?.quantityOnProductionOrder ?? 0)}
                </h3>
                <LuMoveUp className="text-emerald-500 text-lg" />
              </div>
              <div className="flex justify-start items-center gap-1">
                <h3 className={valueClassName}>
                  {formatQuantity(quantities?.quantityOnProductionDemand ?? 0)}
                </h3>
                <LuMoveDown className="text-red-500 text-lg" />
              </div>
            </div>
            {isQuantity ? (
              <span className="text-xs text-muted-foreground md:hidden">
                <Trans>Supply / demand</Trans>
              </span>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <InventoryStorageUnits
        itemStorageUnitQuantities={itemStorageUnitQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode}
        itemTrackingType={itemTrackingType}
        itemShelfLife={itemShelfLife}
        trackedEntityExpirations={trackedEntityExpirations}
        pickMethod={pickMethod}
        storageUnits={storageUnits}
        variant={variant}
      />
    </VStack>
  );
};

export default InventoryDetails;
