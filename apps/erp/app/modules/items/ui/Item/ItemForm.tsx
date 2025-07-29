import type { Database } from "@carbon/database";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
} from "@carbon/react";
import { Link, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { LuEllipsisVertical } from "react-icons/lu";
import type { z } from "zod";
import { TrackingTypeIcon } from "~/components";
import {
  Boolean,
  DefaultMethodType,
  Hidden,
  Input,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure,
} from "~/components/Form";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  itemValidator,
} from "../../items.models";

type ItemFormProps = {
  initialValues: z.infer<typeof itemValidator>;
  type: Database["public"]["Enums"]["itemType"];
};

function getLabel(type: Database["public"]["Enums"]["itemType"]) {
  return capitalize(type);
}

const ItemForm = ({ initialValues, type }: ItemFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {itemTrackingType}
      </span>
    ),
    value: itemTrackingType,
  }));

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Buy"
  );
  const itemReplenishmentSystemOptions =
    itemReplenishmentSystems.map((itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem}
        </span>
      ),
      value: itemReplenishmentSystem,
    })) ?? [];

  return (
    <Card>
      <ValidatedForm
        action={path.to.api.item(type)}
        method="post"
        validator={itemValidator}
        defaultValues={initialValues}
        fetcher={fetcher}
      >
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle className="line-clamp-2">{initialValues.name}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              {initialValues.readableId}
              <Copy text={initialValues.readableId ?? ""} />
            </CardDescription>
          </CardHeader>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  icon={<LuEllipsisVertical />}
                  aria-label="Open menu"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  {/* @ts-ignore */}
                  <Link to={getLinkToItemDetails(type, initialValues.id)}>
                    View Item Master
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </HStack>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="type" />
          <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-3">
            <Input
              isReadOnly
              name="readableId"
              label={`${getLabel(type)} ID`}
            />

            <Input name="name" label="Short Description" />
            <Select
              name="itemTrackingType"
              label="Tracking Type"
              options={itemTrackingTypeOptions}
            />

            <TextArea name="description" label="Description" />

            <Select
              name="replenishmentSystem"
              label="Replenishment System"
              options={itemReplenishmentSystemOptions}
              onChange={(newValue) => {
                setReplenishmentSystem(newValue?.value ?? "Buy");
                if (newValue?.value === "Buy") {
                  setDefaultMethodType("Buy");
                } else {
                  setDefaultMethodType("Make");
                }
              }}
            />
            <DefaultMethodType
              name="defaultMethodType"
              label="Default Method Type"
              replenishmentSystem={replenishmentSystem}
              value={defaultMethodType}
              onChange={(newValue) =>
                setDefaultMethodType(newValue?.value ?? "Buy")
              }
            />
            <UnitOfMeasure name="unitOfMeasureCode" label="Unit of Measure" />

            <Boolean name="active" label="Active" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ItemForm;

export function getLinkToItemDetails(type: MethodItemType, id: string) {
  switch (type) {
    case "Part":
      return path.to.partDetails(id);
    case "Material":
      return path.to.materialDetails(id);
    case "Tool":
      return path.to.toolDetails(id);
    case "Consumable":
      return path.to.consumableDetails(id);
    // case "Service":
    //   return path.to.serviceDetails(id);
    default:
      throw new Error("Invalid type");
  }
}

export function getLinkToItemManufacturing(type: MethodItemType, id: string) {
  switch (type) {
    case "Part":
      return path.to.partManufacturing(id);
    case "Tool":
      return path.to.toolManufacturing(id);
    default:
      return getLinkToItemDetails(type, id);
  }
}

export function getLinkToItemPlanning(type: MethodItemType, id: string) {
  switch (type) {
    case "Part":
      return path.to.partPlanning(id);
    case "Material":
      return path.to.materialPlanning(id);
    case "Tool":
      return path.to.toolPlanning(id);
    case "Consumable":
      return path.to.consumablePlanning(id);
    // case "Service":
    //   return path.to.serviceDetails(id);
    default:
      throw new Error("Invalid type");
  }
}
