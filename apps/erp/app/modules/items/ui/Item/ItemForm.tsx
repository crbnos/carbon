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
  IconButton
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
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
  UnitOfMeasure
} from "~/components/Form";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  itemValidator
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
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();

  const translateItemTrackingType = (v: string) =>
    v === "Inventory"
      ? t`Inventory`
      : v === "Non-Inventory"
        ? t`Non-Inventory`
        : v === "Serial"
          ? t`Serial`
          : t`Batch`;

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {translateItemTrackingType(itemTrackingType)}
      </span>
    ),
    value: itemTrackingType
  }));

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Purchase to Order"
  );
  const itemReplenishmentSystemOptions =
    itemReplenishmentSystems.map((itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem === "Buy"
            ? t`Buy`
            : itemReplenishmentSystem === "Make"
              ? t`Make`
              : t`Buy and Make`}
        </span>
      ),
      value: itemReplenishmentSystem
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
                  aria-label={t`Open menu`}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  {/* @ts-ignore */}
                  <Link to={getLinkToItemDetails(type, initialValues.id)}>
                    <Trans>View Item Master</Trans>
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

            <Input
              name="name"
              label={t`Short Description`}
              characterLimit={40}
            />
            <Select
              name="itemTrackingType"
              label={t`Tracking Type`}
              options={itemTrackingTypeOptions}
            />

            <Select
              name="replenishmentSystem"
              label={t`Replenishment System`}
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
              label={t`Default Method Type`}
              replenishmentSystem={replenishmentSystem}
              value={defaultMethodType}
              onChange={(newValue) =>
                setDefaultMethodType(newValue?.value ?? "Buy")
              }
            />
            <UnitOfMeasure
              name="unitOfMeasureCode"
              label={t`Unit of Measure`}
            />

            <Boolean name="active" label={t`Active`} />
          </div>
          <div className="mt-4 w-full">
            <TextArea name="description" label={t`Long Description`} />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>
            <Trans>Save</Trans>
          </Submit>
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
      return path.to.partDetails(id);
    case "Tool":
      return path.to.toolDetails(id);
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
