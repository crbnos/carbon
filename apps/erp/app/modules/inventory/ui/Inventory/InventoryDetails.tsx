import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  VStack,
} from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import type { z } from "zod";
import type {
  ItemQuantities,
  ItemShelfQuantities,
  itemTrackingTypes,
  pickMethodValidator,
} from "~/modules/items";
import type { ListItem } from "~/types";
import InventoryShelves from "./InventoryShelves";

type InventoryDetailsProps = {
  itemShelfQuantities: ItemShelfQuantities[];
  itemUnitOfMeasureCode: string;
  itemTrackingType: (typeof itemTrackingTypes)[number];
  pickMethod: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities | null;
  shelves: ListItem[];
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
              <VStack>Quantity on Purchase Order</VStack>
            </CardDescription>
            <CardTitle className="text-4xl ">
              {`${formatter.format(quantities?.quantityOnPurchaseOrder ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8">
            <CardDescription>
              <VStack>Quantity on Sales Order</VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(quantities?.quantityOnSalesOrder ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-8 ">
            <CardDescription>
              <VStack>Quantity on Production Order</VStack>
            </CardDescription>
            <CardTitle className="text-4xl">
              {`${formatter.format(
                quantities?.quantityOnProductionOrder ?? 0
              )}`}
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
