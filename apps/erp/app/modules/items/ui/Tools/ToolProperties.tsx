import type { Json } from "@carbon/database";
import { InputControlled, Select, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useEffect } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { Await, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Boolean, ItemPostingGroup, Tags } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { useSuppliers } from "~/stores";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";
import type {
  ItemFile,
  MakeMethod,
  PickMethod,
  SupplierPart,
  Tool
} from "../../types";
import { FileBadge } from "../Item";

const ToolProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedToolsData = useRouteData<{ locations: ListItem[] }>(
    path.to.toolRoot
  );
  const routeData = useRouteData<{
    toolSummary: Tool;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    pickMethods: PickMethod[];
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
    tags: { name: string }[];
  }>(path.to.tool(itemId));

  const locations = sharedToolsData?.locations ?? [];
  const supplierParts = routeData?.supplierParts ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  // const optimisticAssignment = useOptimisticAssignment({
  //   id: itemId,
  //   table: "item",
  // });
  // const assignee =
  //   optimisticAssignment !== undefined
  //     ? optimisticAssignment
  //     : routeData?.toolSummary?.assignee;

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (
      field:
        | "name"
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemTrackingType"
        | "itemPostingGroupId"
        | "toolId"
        | "active",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("items", itemId);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateItems
      });
    },

    [itemId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", routeData?.toolSummary?.readableId ?? "");
      formData.append("table", "tool");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },

    [routeData?.toolSummary?.readableId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.toolSummary?.readableId ?? "");
      formData.append("table", "tool");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [routeData?.toolSummary?.readableId]
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
                      window.location.origin + path.to.tool(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to tool</span>
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
                    copyToClipboard(routeData?.toolSummary?.id ?? "")
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy tool unique identifier</span>
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
                      routeData?.toolSummary?.readableIdWithRevision ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy tool number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={1} className="pt-2">
          <ValidatedForm
            defaultValues={{
              toolId:
                routeData?.toolSummary?.readableIdWithRevision ?? undefined
            }}
            validator={z.object({
              toolId: z.string()
            })}
            className="w-full -mt-2"
          >
            <span className="text-sm">
              <InputControlled
                label=""
                name="toolId"
                inline
                size="sm"
                value={routeData?.toolSummary?.readableId ?? ""}
                onBlur={(e) => {
                  onUpdate("toolId", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
          <ValidatedForm
            defaultValues={{
              name: routeData?.toolSummary?.name ?? undefined
            }}
            validator={z.object({
              name: z.string()
            })}
            className="w-full -mt-2"
          >
            <span className="text-xs text-muted-foreground">
              <InputControlled
                label=""
                name="name"
                inline
                size="sm"
                value={routeData?.toolSummary?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
        <ItemThumbnailUpload
          path={routeData?.toolSummary?.thumbnailPath}
          itemId={itemId}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{
          itemPostingGroupId:
            routeData?.toolSummary?.itemPostingGroupId ?? undefined
        }}
        validator={z.object({
          itemPostingGroupId: z.string().nullable().optional()
        })}
        className="w-full"
      >
        <ItemPostingGroup
          label="Item Group"
          name="itemPostingGroupId"
          inline
          onChange={(value) => {
            onUpdate("itemPostingGroupId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          itemTrackingType:
            routeData?.toolSummary?.itemTrackingType ?? undefined
        }}
        validator={z.object({
          itemTrackingType: z.string()
        })}
        className="w-full"
      >
        <Select
          name="itemTrackingType"
          label="Tracking Type"
          inline={(value) => (
            <Badge variant="secondary">
              <TrackingTypeIcon type={value} className="mr-2" />
              <span>{value}</span>
            </Badge>
          )}
          options={itemTrackingTypes.map((type) => ({
            value: type,
            label: (
              <span className="flex items-center gap-2">
                <TrackingTypeIcon type={type} />
                {type}
              </span>
            )
          }))}
          onChange={(value) => {
            onUpdate("itemTrackingType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          defaultMethodType:
            routeData?.toolSummary?.defaultMethodType ?? undefined
        }}
        validator={z.object({
          defaultMethodType: z.string()
        })}
        className="w-full"
      >
        <Select
          name="defaultMethodType"
          label="Default Method Type"
          inline={(value) => (
            <Badge variant="secondary">
              <MethodIcon type={value} className="mr-2" />
              <span>{value}</span>
            </Badge>
          )}
          options={methodType
            .filter((type) => type !== "Make")
            .map((type) => ({
              value: type,
              label: (
                <span className="flex items-center gap-2">
                  <MethodIcon type={type} />
                  {type}
                </span>
              )
            }))}
          onChange={(value) => {
            onUpdate("defaultMethodType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          replenishmentSystem:
            routeData?.toolSummary?.replenishmentSystem ?? undefined
        }}
        validator={z.object({
          replenishmentSystem: z.string()
        })}
        className="w-full"
      >
        <Select
          name="replenishmentSystem"
          label="Replenishment"
          inline={(value) => (
            <Badge variant="secondary">
              <ReplenishmentSystemIcon type={value} className="mr-2" />
              <span>{value}</span>
            </Badge>
          )}
          options={itemReplenishmentSystems.map((system) => ({
            value: system,
            label: (
              <span className="flex items-center gap-2">
                <ReplenishmentSystemIcon type={system} />
                {system}
              </span>
            )
          }))}
          onChange={(value) => {
            onUpdate("replenishmentSystem", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Unit of Measure</h3>
        <Enumerable value={routeData?.toolSummary?.unitOfMeasure ?? null} />
      </VStack>

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Methods</h3>
        </HStack>
        {routeData?.toolSummary?.replenishmentSystem?.includes("Make") && (
          <Suspense fallback={null}>
            <Await resolve={routeData?.makeMethods}>
              {(makeMethods) =>
                makeMethods.data
                  ?.sort((a, b) => b.version - a.version)
                  .map((method) => {
                    const isActive =
                      method.status === "Active" ||
                      makeMethods.data?.length === 1;
                    return (
                      <MethodBadge
                        key={method.id}
                        type={isActive ? "Make" : "Make Inactive"}
                        text={`Version ${method.version}`}
                        to={`${path.to.toolDetails(itemId)}?methodId=${method.id}`}
                      />
                    );
                  })
              }
            </Await>
          </Suspense>
        )}
        {routeData?.toolSummary?.replenishmentSystem?.includes("Buy") &&
          supplierParts.map((method) => (
            <MethodBadge
              key={method.id}
              type="Buy"
              text={
                suppliers.find((s) => s.id === method.supplierId)?.name ?? ""
              }
              to={path.to.partPurchasing(itemId)}
            />
          ))}
        {pickMethods.map((method) => (
          <MethodBadge
            key={method.locationId}
            type="Pick"
            text={locations.find((l) => l.id === method.locationId)?.name ?? ""}
            to={path.to.partInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>
      <ValidatedForm
        defaultValues={{
          active: routeData?.toolSummary?.active ?? undefined
        }}
        validator={z.object({
          active: zfd.checkbox()
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
          tags: routeData?.toolSummary?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          label="Tags"
          name="tags"
          availableTags={routeData?.tags ?? []}
          table="tool"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.toolSummary?.customFields ?? {}) as Record<string, Json>
        }
        table="tool"
        tags={routeData?.toolSummary?.tags ?? []}
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
                  itemType="Tool"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default ToolProperties;
