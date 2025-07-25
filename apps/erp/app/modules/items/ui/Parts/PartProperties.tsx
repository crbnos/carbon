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
import { Await, Link, useFetcher, useParams } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useEffect } from "react";
import {
  LuCopy,
  LuExternalLink,
  LuKeySquare,
  LuLink,
  LuMove3D,
} from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/components";
import { Boolean, Tags, UnitOfMeasure } from "~/components/Form";
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
  itemTrackingTypes,
} from "../../items.models";
import type {
  ItemFile,
  MakeMethod,
  PartSummary,
  PickMethod,
  SupplierPart,
} from "../../types";
import { FileBadge } from "../Item";

const PartProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedPartsData = useRouteData<{ locations: ListItem[] }>(
    path.to.partRoot
  );
  const routeData = useRouteData<{
    partSummary: PartSummary;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    pickMethods: PickMethod[];
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
    tags: { name: string }[];
  }>(path.to.part(itemId));

  const locations = sharedPartsData?.locations ?? [];
  const supplierParts = routeData?.supplierParts ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  // const optimisticAssignment = useOptimisticAssignment({
  //   id: itemId,
  //   table: "item",
  // });
  // const assignee =
  //   optimisticAssignment !== undefined
  //     ? optimisticAssignment
  //     : routeData?.partSummary?.assignee;

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onUpdate = useCallback(
    (
      field:
        | "active"
        | "defaultMethodType"
        | "itemTrackingType"
        | "partId"
        | "name"
        | "replenishmentSystem"
        | "unitOfMeasureCode",
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
    [routeData?.partSummary?.id]
  );

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", routeData?.partSummary?.readableId ?? "");
      formData.append("table", "part");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.partSummary?.readableId]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.partSummary?.readableId ?? "");
      formData.append("table", "part");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.partSummary?.readableId]
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
                      window.location.origin + path.to.part(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to part</span>
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
                    copyToClipboard(routeData?.partSummary?.id ?? "")
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy part unique identifier</span>
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
                      routeData?.partSummary?.readableIdWithRevision ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy part number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={1} className="pt-2">
          <ValidatedForm
            defaultValues={{
              partId:
                routeData?.partSummary?.readableIdWithRevision ?? undefined,
            }}
            validator={z.object({
              partId: z.string(),
            })}
            className="w-full -mt-2"
          >
            <span className="text-sm">
              <InputControlled
                label=""
                name="partId"
                inline
                size="sm"
                value={routeData?.partSummary?.readableId ?? ""}
                onBlur={(e) => {
                  onUpdate("partId", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
          <ValidatedForm
            defaultValues={{
              name: routeData?.partSummary?.name ?? undefined,
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
                value={routeData?.partSummary?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
        <ItemThumbnailUpload
          path={routeData?.partSummary?.thumbnailPath}
          itemId={itemId}
          modelId={routeData?.partSummary?.modelId}
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
                type={routeData?.partSummary?.itemTrackingType!}
                className={cn(
                  "mr-2",
                  routeData?.partSummary?.active === false && "opacity-50"
                )}
              />
              <span>{routeData?.partSummary?.itemTrackingType!}</span>
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
                type={routeData?.partSummary?.defaultMethodType!}
                className={cn(
                  "mr-2",
                  routeData?.partSummary?.active === false && "opacity-50"
                )}
              />
              <span>{routeData?.partSummary?.defaultMethodType!}</span>
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {methodType.map((type) => (
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
        <h3 className="text-xs text-muted-foreground">Replenishment</h3>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Badge variant="secondary">
              <ReplenishmentSystemIcon
                type={routeData?.partSummary?.replenishmentSystem!}
                className="mr-2"
              />
              <span>{routeData?.partSummary?.replenishmentSystem!}</span>
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {itemReplenishmentSystems.map((system) => (
              <DropdownMenuItem
                key={system}
                onClick={() => onUpdate("replenishmentSystem", system)}
              >
                <DropdownMenuIcon
                  icon={<ReplenishmentSystemIcon type={system} />}
                />
                <span>{system}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </VStack>

      <ValidatedForm
        defaultValues={{
          unitOfMeasureCode:
            routeData?.partSummary?.unitOfMeasureCode ?? undefined,
        }}
        validator={z.object({
          unitOfMeasureCode: z
            .string()
            .min(1, { message: "Unit of Measure is required" }),
        })}
        className="w-full"
      >
        <UnitOfMeasure
          label="Unit of Measure"
          name="unitOfMeasureCode"
          inline
          onChange={(value) => {
            onUpdate("unitOfMeasureCode", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Methods</h3>
        </HStack>
        {routeData?.partSummary?.replenishmentSystem?.includes("Make") && (
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
                        to={path.to.partMakeMethod(itemId, method.id)}
                      />
                    );
                  })
              }
            </Await>
          </Suspense>
        )}
        {routeData?.partSummary?.replenishmentSystem?.includes("Buy") &&
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
          active: routeData?.partSummary?.active ?? undefined,
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
          tags: routeData?.partSummary?.tags ?? [],
        }}
        validator={z.object({
          tags: z.array(z.string()).optional(),
        })}
        className="w-full"
      >
        <Tags
          availableTags={routeData?.tags ?? []}
          label="Tags"
          name="tags"
          table="part"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.partSummary?.customFields ?? {}) as Record<string, Json>
        }
        table="part"
        tags={routeData?.partSummary?.tags ?? []}
        onUpdate={onUpdateCustomFields}
      />

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Files</h3>
        </HStack>
        {routeData?.partSummary?.modelId && (
          <Link
            className="group flex items-center gap-1"
            to={path.to.file.cadModel(routeData?.partSummary.modelId)}
            target="_blank"
          >
            <Badge variant="secondary">
              <LuMove3D className="w-3 h-3 mr-1 text-emerald-500" />
              3D Model
            </Badge>
            <span className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground">
              <LuExternalLink />
            </span>
          </Link>
        )}

        <Suspense fallback={null}>
          <Await resolve={routeData?.files}>
            {(files) =>
              files?.map((file) => (
                <FileBadge
                  key={file.id}
                  file={file}
                  itemId={itemId}
                  itemType="Part"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default PartProperties;
