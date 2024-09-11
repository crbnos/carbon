import { Badge, CardHeader, CardTitle, HStack } from "@carbon/react";
import { useRevalidator } from "@remix-run/react";
import type { z } from "zod";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { ItemQuantities, pickMethodValidator } from "~/modules/items";
import InventoryItemIcon from "./InventoryItemIcon";

type InventoryTransactionsProps = {
  initialValues: z.infer<typeof pickMethodValidator>;
  quantities: ItemQuantities;
  shelves: string[];
};

const InventoryTransactions = ({
  initialValues,
  quantities,
  shelves,
}: InventoryTransactionsProps) => {
  const permissions = usePermissions();
  const { supabase } = useSupabase();
  const user = useUser();
  const revalidator = useRevalidator();

  const shelfOptions = shelves.map((shelf) => ({ value: shelf, label: shelf }));

  return (
    <HStack className="w-full justify-between items-start">
      <CardHeader>
        <HStack>
          <CardTitle>{quantities.readableId}</CardTitle>
          {quantities.type && (
            <Badge variant="secondary">
              <InventoryItemIcon type={quantities.type} />
            </Badge>
          )}
        </HStack>
      </CardHeader>
    </HStack>
  );
};

export default InventoryTransactions;
