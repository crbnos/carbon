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
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/components";
import { Boolean, Tags, UnitOfMeasure } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { itemTrackingTypes } from "../../items.models";
import type { ItemFile, Material, PickMethod, SupplierPart } from "../../types";
import { FileBadge } from "../Item";
import Substance from "~/components/Form/Substance";
import Shape from "~/components/Form/Shape";

const MaterialProperties = () => {
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  const sharedMaterialsData = useRouteData<{ locations: ListItem[] }>(
    path.to.materialRoot
  );
  const routeData = useRouteData<{
    materialSummary: Material;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    pickMethods: PickMethod[];
    tags: { name: string }[];
  }>(path.to.material(itemId));

  const locations = sharedMaterialsData?.locations ?? [];
  const supplierParts = routeData?.supplierParts ?? [];
  const pickMethods = routeData?.pickMethods ?? [];

  // const optimisticAssignment = useOptimisticAssignment({
  //   id: itemId,
  //   table: "item",
  // });
  // const assignee =
  //   optimisticAssignment !== undefined
  //     ? optimisticAssignment
  //     : routeData?.materialSummary?.assignee;

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
        | "active"
        | "unitOfMeasureCode"
        | "materialFormId"
        | "materialSubstanceId"
        | "grade"
        | "dimensions"
        | "finish",
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

      formData.append("ids", itemId);
      formData.append("table", "material");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", itemId);
      formData.append("table", "material");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId]
  );

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
                      window.location.origin + path.to.material(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to material</span>
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
                    copyToClipboard(routeData?.materialSummary?.itemId ?? "")
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy material unique identifier</span>
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
                    copyToClipboard(routeData?.materialSummary?.id ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy material number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={0}>
          <span className="text-sm tracking-tight">
            {routeData?.materialSummary?.id}
          </span>
          <ValidatedForm
            defaultValues={{
              name: routeData?.materialSummary?.name ?? undefined,
            }}
            validator={z.object({
              name: z
                .string()
                
            })}
            className="w-full -mt-2"
          >
            <span className="text-xs text-muted-foreground">
              <InputControlled
                label=""
                name="name"
                inline
                size="sm"
                value={routeData?.materialSummary?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
        <ItemThumbnailUpload
          path={routeData?.materialSummary?.thumbnailPath}
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
                type={routeData?.materialSummary?.itemTrackingType!}
                className={cn(
                  "mr-2",
                  routeData?.materialSummary?.active === false && "opacity-50"
                )}
              />
              <span>{routeData?.materialSummary?.itemTrackingType!}</span>
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
                type={routeData?.materialSummary?.defaultMethodType!}
                className={cn(
                  "mr-2",
                  routeData?.materialSummary?.active === false && "opacity-50"
                )}
              />
              <span>{routeData?.materialSummary?.defaultMethodType!}</span>
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

      <ValidatedForm
        defaultValues={{
          materialFormId:
            routeData?.materialSummary?.materialFormId ?? undefined,
        }}
        validator={z.object({
          materialFormId: z.string().nullable(),
        })}
        className="w-full"
      >
        <Shape
          label="Shape"
          name="materialFormId"
          inline
          onChange={(value) => {
            onUpdate("materialFormId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          materialSubstanceId:
            routeData?.materialSummary?.materialSubstanceId ?? undefined,
        }}
        validator={z.object({
          materialSubstanceId: z.string().nullable(),
        })}
        className="w-full"
      >
        <Substance
          label="Substance"
          name="materialSubstanceId"
          inline
          onChange={(value) => {
            onUpdate("materialSubstanceId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      {(["grade", "dimensions", "finish"] as const).map((fieldName) => (
        <ValidatedForm
          key={fieldName}
          defaultValues={{
            [fieldName]: routeData?.materialSummary?.[fieldName] ?? "",
          }}
          validator={z.object({
            [fieldName]: zfd.text(z.string().optional()),
          })}
          className="w-full"
        >
          <InputControlled
            name={fieldName}
            label={fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}
            value={routeData?.materialSummary?.[fieldName] ?? ""}
            size="sm"
            inline
            onBlur={(e) => {
              onUpdate(fieldName, e.target.value);
            }}
          />
        </ValidatedForm>
      ))}

      <ValidatedForm
        defaultValues={{
          unitOfMeasureCode:
            routeData?.materialSummary?.unitOfMeasureCode ?? undefined,
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

        {routeData?.materialSummary?.replenishmentSystem?.includes("Buy") &&
          supplierParts.map((method) => (
            <MethodBadge
              key={method.id}
              type="Buy"
              text={method?.supplier?.name ?? ""}
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
          active: routeData?.materialSummary?.active ?? undefined,
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
          tags: routeData?.materialSummary?.tags ?? [],
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
          table="material"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.materialSummary?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="material"
        tags={routeData?.materialSummary?.tags ?? []}
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
                  itemType="Material"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default MaterialProperties;
