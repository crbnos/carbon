import { Badge, CardHeader, CardTitle, HStack } from "@carbon/react";
import type { z } from "zod";
import { MethodItemTypeIcon } from "~/components";
import type { ItemQuantities, pickMethodValidator } from "~/modules/items";

type InventoryTransactionsProps = {
  initialValues: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
};

const InventoryTransactions = ({
  initialValues,
  quantities,
}: InventoryTransactionsProps) => {
  return (
    <HStack className="w-full justify-between items-start">
      <CardHeader>
        <HStack>
          <CardTitle>{quantities.readableId}</CardTitle>
          {quantities.type && (
            <Badge variant="secondary">
              <MethodItemTypeIcon type={quantities.type} />
            </Badge>
          )}
        </HStack>
      </CardHeader>
    </HStack>
  );
};

export default InventoryTransactions;
