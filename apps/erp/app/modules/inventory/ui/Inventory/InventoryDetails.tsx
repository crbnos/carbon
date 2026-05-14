import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import { LuMoveDown, LuMoveUp } from "react-icons/lu";
import type { z } from "zod";
import { DateSelect } from "~/components/DateSelect";
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
};

const InventoryDetails = ({
  itemStorageUnitQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  itemShelfLife,
  trackedEntityExpirations,
  pickMethod,
  quantities,
  storageUnits
}: InventoryDetailsProps) => {
  const { locale } = useLocale();
  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true
  });
  const [usageWindow, setUsageWindow] = useState<"30" | "90">("30");
  const dailyUsage =
    usageWindow === "30"
      ? (quantities?.usageLast30Days ?? 0)
      : (quantities?.usageLast90Days ?? 0);

  return (
    <VStack>
      <div className="w-full grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Quantity on Hand</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter">
              {formatter.format(quantities?.quantityOnHand ?? 0)}
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
            <h3 className="text-4xl font-medium tracking-tighter">
              {formatter.format(quantities?.daysRemaining ?? 0)}
            </h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>
              <Trans>Daily Usage</Trans>
            </CardTitle>
            <DateSelect
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
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter">
              {formatter.format(dailyUsage)}
            </h3>
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
              <h3 className="text-4xl font-medium tracking-tighter">
                {formatter.format(quantities?.quantityOnPurchaseOrder ?? 0)}
              </h3>
              <LuMoveUp className="text-emerald-500 text-lg" />
            </div>
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
              <h3 className="text-4xl font-medium tracking-tighter">
                {formatter.format(quantities?.quantityOnSalesOrder ?? 0)}
              </h3>
              <LuMoveDown className="text-red-500 text-lg" />
            </div>
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
                <h3 className="text-4xl font-medium tracking-tighter">
                  {formatter.format(quantities?.quantityOnProductionOrder ?? 0)}
                </h3>
                <LuMoveUp className="text-emerald-500 text-lg" />
              </div>
              <div className="flex justify-start items-center gap-1">
                <h3 className="text-4xl font-medium tracking-tighter">
                  {formatter.format(
                    quantities?.quantityOnProductionDemand ?? 0
                  )}
                </h3>
                <LuMoveDown className="text-red-500 text-lg" />
              </div>
            </div>
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
      />
    </VStack>
  );
};

export default InventoryDetails;
