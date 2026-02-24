import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { LuMoveDown, LuMoveUp } from "react-icons/lu";
import type { z } from "zod";
import type {
  ItemQuantities,
  ItemShelfQuantities,
  itemTrackingTypes,
  pickMethodValidator
} from "~/modules/items";
import InventoryShelves from "./InventoryShelves";

type InventoryDetailsProps = {
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  pickMethod: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities | null;
  shelves: { value: string; label: string }[];
};

const InventoryDetails = ({
  itemShelfQuantities,
  itemUnitOfMeasureCode,
  itemTrackingType,
  pickMethod,
  quantities,
  shelves
}: InventoryDetailsProps) => {
  const { locale } = useLocale();
  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true
  });

  return (
    <VStack>
      <div className="w-full grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quantity on Hand</CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter">
              {formatter.format(quantities?.quantityOnHand ?? 0)}
            </h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Days Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter">
              {formatter.format(quantities?.daysRemaining ?? 0)}
            </h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Daily Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-4xl font-medium tracking-tighter">
              {formatter.format(quantities?.usageLast30Days ?? 0)}
            </h3>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quantity on Purchase Order</CardTitle>
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
            <CardTitle>Quantity on Sales Order</CardTitle>
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
            <CardTitle>Quantity on Jobs</CardTitle>
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
      <InventoryShelves
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode}
        itemTrackingType={itemTrackingType}
        pickMethod={pickMethod}
        shelves={shelves}
      />
    </VStack>
  );
};

export default InventoryDetails;
