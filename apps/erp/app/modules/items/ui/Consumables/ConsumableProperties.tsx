import type { Json } from "@carbon/database";
import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  cn,
  toast,
} from "@carbon/react";
import { Await, useFetcher, useParams } from "@remix-run/react";
import { Suspense, useCallback, useEffect } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Boolean, Tags } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { useSuppliers } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { itemTrackingTypes } from "../../items.models";
import type {
  Consumable,
  ItemFile,
  PickMethod,
  SupplierPart,
} from "../../types";
import { FileBadge } from "../Item";

const ConsumableProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedConsumablesData = useRouteData<{ locations: ListItem[] }>(
    path.to.consumableRoot
  );
  const routeData = useRouteData<{
    consumableSummary: Consumable;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    pickMethods: PickMethod[];
    tags: { name: string }[];
  }>(path.to.consumable(itemId));

  const locations = sharedConsumablesData?.locations ?? [];
  const supplierParts = routeData?.supplierParts ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  // const optimisticAssignment = useOptimisticAssignment({
  //   id: itemId,
  //   table: "item",
  // });
  // const assignee =
  //   optimisticAssignment !== undefined
  //     ? optimisticAssignment
  //     : routeData?.consumableSummary?.assignee;

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);
  const onUpdate = useCallback(
    (
      field:
        | "name"
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemTrackingType"
        | "consumableId"
        | "active",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("items", itemId);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId]
  );

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", routeData?.consumableSummary?.readableId ?? "");
      formData.append("table", "consumable");

      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.consumableSummary?.readableId]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.consumableSummary?.readableId ?? "");
      formData.append("table", "consumable");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.consumableSummary?.readableId]
  );

  const [suppliers] = useSuppliers();

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Properties</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin + path.to.consumable(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to consumable</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      routeData?.consumableSummary?.readableIdWithRevision ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy consumable number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={1} className="pt-2">
          <ValidatedForm
            defaultValues={{
              consumableId:
                routeData?.consumableSummary?.readableIdWithRevision ?? undefined,
            }}
            validator={z.object({
              consumableId: z.string(),
            })}
            className="w-full -mt-2"
          >
            <span className="text-sm">
              <InputControlled
                label=""
                name="consumableId"
                inline
                size="sm"
                value={routeData?.consumableSummary?.readableId ?? ""}
                onBlur={(e) => {
                  onUpdate("consumableId", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
          <ValidatedForm
            defaultValues={{
              name: routeData?.consumableSummary?.name ?? undefined,
            }}
            validator={z.object({
              name: z.string(),
            })}
            className="w-full -mt-2"
          >
            <span className="text-xs text-muted-foreground">
              <InputControlled
                label=""
                name="name"
                inline
                size="sm"
                value={routeData?.consumableSummary?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
        <ItemThumbnailUpload
          path={routeData?.consumableSummary?.thumbnailPath}
          itemId={itemId}
        />
      </VStack>
      {/* <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={itemId}
          table="item"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "parts")}
        />
      </VStack> */}

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Tracking Type</h3>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Badge variant="secondary">
              <TrackingTypeIcon
                type={routeData?.consumableSummary?.itemTrackingType!}
                className={cn(
                  "mr-2",
                  routeData?.consumableSummary?.active === false && "opacity-50"
                )}
              />
              <span>{routeData?.consumableSummary?.itemTrackingType!}</span>
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {itemTrackingTypes.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => onUpdate("itemTrackingType", type)}
              >
                <DropdownMenuIcon icon={<TrackingTypeIcon type={type} />} />
                <span>{type}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Default Method Type</h3>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Badge variant="secondary">
              <MethodIcon
                type={routeData?.consumableSummary?.defaultMethodType!}
                className={cn(
                  "mr-2",
                  routeData?.consumableSummary?.active === false && "opacity-50"
                )}
              />
              <span>{routeData?.consumableSummary?.defaultMethodType!}</span>
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {methodType
              .filter((type) => type !== "Make")
              .map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onUpdate("defaultMethodType", type)}
                >
                  <DropdownMenuIcon icon={<MethodIcon type={type} />} />
                  <span>{type}</span>
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Unit of Measure</h3>
        <Enumerable
          value={routeData?.consumableSummary?.unitOfMeasure ?? null}
        />
      </VStack>

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Methods</h3>
        </HStack>

        {routeData?.consumableSummary?.replenishmentSystem?.includes("Buy") &&
          supplierParts.map((method) => (
            <MethodBadge
              key={method.id}
              type="Buy"
              text={
                suppliers.find((s) => s.id === method.supplierId)?.name ?? ""
              }
              to={path.to.consumablePurchasing(itemId)}
            />
          ))}
        {pickMethods.map((method) => (
          <MethodBadge
            key={method.locationId}
            type="Pick"
            text={locations.find((l) => l.id === method.locationId)?.name ?? ""}
            to={path.to.consumableInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>
      <ValidatedForm
        defaultValues={{
          active: routeData?.consumableSummary?.active ?? undefined,
        }}
        validator={z.object({
          active: zfd.checkbox(),
        })}
        className="w-full"
      >
        <Boolean
          label="Active"
          name="active"
          variant="small"
          onChange={(value) => {
            onUpdate("active", value ? "on" : "off");
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          tags: routeData?.consumableSummary?.tags ?? [],
        }}
        validator={z.object({
          tags: z.array(z.string()).optional(),
        })}
        className="w-full"
      >
        <Tags
          label="Tags"
          name="tags"
          availableTags={routeData?.tags ?? []}
          table="consumable"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.consumableSummary?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="consumable"
        tags={routeData?.consumableSummary?.tags ?? []}
        onUpdate={onUpdateCustomFields}
      />

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Files</h3>
        </HStack>

        <Suspense fallback={null}>
          <Await resolve={routeData?.files}>
            {(files) =>
              files?.map((file) => (
                <FileBadge
                  key={file.id}
                  file={file}
                  itemId={itemId}
                  itemType="Consumable"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default ConsumableProperties;
