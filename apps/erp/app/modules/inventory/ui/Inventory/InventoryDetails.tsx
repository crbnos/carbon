import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { LuMoveDown, LuMoveUp } from "react-icons/lu";
import type { z } from "zod";
import type {
  ItemQuantities,
  ItemShelfQuantities,
  itemTrackingTypes,
  pickMethodValidator,
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
  shelves,
}: InventoryDetailsProps) => {
  const { locale } = useLocale();
  const formatter = Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  });

  return (
    <VStack>
      <div className="w-full grid gap-2 grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>Quantity on Hand</VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities?.quantityOnHand ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>Days Remaining</VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities?.daysRemaining ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>Daily Usage</VStack>
            </CardDescription>
            <CardTitle className="text-4xl ">
              <div className="flex justify-start items-center gap-1">
                {`${formatter.format(quantities?.usageLast30Days ?? 0)}`}
              </div>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>Quantity on Purchase Order</VStack>
            </CardDescription>
            <CardTitle className="text-4xl ">
              <div className="flex justify-start items-center gap-1">
                {`${formatter.format(
                  quantities?.quantityOnPurchaseOrder ?? 0
                )}`}
                <LuMoveUp className="text-emerald-500 text-lg" />
              </div>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>Quantity on Sales Order</VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              <div className="flex justify-start items-center gap-1">
                {`${formatter.format(quantities?.quantityOnSalesOrder ?? 0)}`}
                <LuMoveDown className="text-red-500 text-lg" />
              </div>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8 ">
            <CardDescription>
              <VStack>Quantity on Production Order</VStack>
            </CardDescription>
            <CardTitle className="text-4xl flex items-start justify-start gap-2">
              <div className="flex justify-start items-center gap-1">
                <span>{`${formatter.format(
                  quantities?.quantityOnProductionOrder ?? 0
                )}`}</span>
                <LuMoveUp className="text-emerald-500 text-lg" />
              </div>

              <div className="flex justify-start items-center gap-1">
                <span>{`${formatter.format(
                  quantities?.quantityOnProductionDemand ?? 0
                )}`}</span>
                <LuMoveDown className="text-red-500 text-lg" />
              </div>
            </CardTitle>
          </CardHeader>
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
