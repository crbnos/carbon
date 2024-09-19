import { Badge, Button, Combobox, HStack, VStack } from "@carbon/react";

import { useNavigate, useParams } from "@remix-run/react";
import { LuX } from "react-icons/lu";
import type { z } from "zod";
import { MethodItemTypeIcon } from "~/components";
import { DetailsTopbar } from "~/components/Layout";
import { useRouteData, useUrlParams } from "~/hooks";
import type { pickMethodValidator } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { useInventoryNavigation } from "./useInventoryNavigation";

type InventoryItemHeaderProps = {
  pickMethod: z.infer<typeof pickMethodValidator>;
  itemReadableId: string;
  itemName: string;
  itemType: string;
};

const InventoryItemHeader = ({
  pickMethod,
  itemReadableId,
  itemName,
  itemType,
}: InventoryItemHeaderProps) => {
  const links = useInventoryNavigation();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");
  const [params] = useUrlParams();

  const navigate = useNavigate();

  const routeData = useRouteData<{ locations: ListItem[] }>(
    path.to.inventoryRoot
  );

  const locationOptions =
    routeData?.locations?.map((location) => ({
      value: location.id,
      label: location.name,
    })) ?? [];

  return (
    <div>
      <VStack className="flex">
        <div className="flex justify-between w-full">
          <Button
            isIcon
            variant="ghost"
            onClick={() =>
              navigate(`${path.to.inventory}?${params.toString()}`)
            }
          >
            <LuX className="w-4 h-4" />
          </Button>
          <DetailsTopbar links={links} />
        </div>
        <HStack className="justify-between w-full">
          <div className="p-2 pb-3">
            <div className="text-2xl font-semibold">
              {itemReadableId}{" "}
              <Badge className="ml-2" variant="secondary">
                <MethodItemTypeIcon type={itemType} />
              </Badge>
            </div>
            <div className="max-w-lg text-balance leading-relaxed text-muted-foreground">
              {itemName}
            </div>
          </div>
          <div className="p-2">
            <Combobox
              size="sm"
              value={pickMethod.locationId}
              options={locationOptions}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = `${path.to.inventoryItem(
                  pickMethod.itemId!
                )}?location=${selected}`;
              }}
              className="w-64"
            />
          </div>
        </HStack>
      </VStack>
    </div>
  );
};

export default InventoryItemHeader;
