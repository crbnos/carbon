import type { Json } from "@carbon/database";
import { InputControlled, Select, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useEffect } from "react";
import {
  LuCopy,
  LuExternalLink,
  LuKeySquare,
  LuLink,
  LuMove3D
} from "react-icons/lu";
import { Await, Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon, TrackingTypeIcon } from "~/components";
import {
  Boolean,
  ItemPostingGroup,
  Tags,
  UnitOfMeasure
} from "~/components/Form";
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
  type ChangeOrderChangeType,
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";
import type {
  ItemFile,
  MakeMethod,
  PartSummary,
  PickMethod,
  SupplierPart
} from "../../types";
import { FileBadge, ItemDescription, SourcingTypeProperty } from "../Item";

export type PartPropertiesData = {
  itemId: string;
  locations: ListItem[];
  partSummary: PartSummary;
  files: Promise<ItemFile[]>;
  supplierParts: SupplierPart[];
  pickMethods: PickMethod[];
  makeMethods: Promise<PostgrestResponse<MakeMethod>>;
  tags: { name: string }[];
};

type PartPropertiesProps = {
  data?: PartPropertiesData;
  // When embedded (e.g. inside a change-order affected-item card) drop the
  // fixed-width sidebar chrome and flow with the parent container.
  embedded?: boolean;
  // Which slice to render. "all" (default, the part sidebar) shows everything;
  // "properties" omits the image + files. Lets a caller (the CO card) render
  // just the attribute fields and delegate files/CAD to ItemDocuments + CadModel.
  section?: "all" | "properties";
  // Field presentation. "sidebar" (default) = the compact inline click-to-edit
  // rows of the part detail sidebar. "form" = standard labeled form fields (used
  // by the CO card). Only affects presentation — persistence is unchanged.
  layout?: "sidebar" | "form";
  // Read-only: every field/control is non-editable (used when the change order
  // is released/locked). Defaults to editable.
  isReadOnly?: boolean;
  // The change-order change type this card is embedded for (a CO line). A
  // `Revision` keeps the source part number, so the Part Number field is locked
  // (Name + the other attributes stay editable); `New Part` gets a fresh number
  // and stays editable.
  changeType?: ChangeOrderChangeType;
};

const PartProperties = ({
  data,
  embedded,
  section = "all",
  layout = "sidebar",
  isReadOnly = false,
  changeType
}: PartPropertiesProps) => {
  // Inline click-to-edit only in the sidebar layout; the form layout renders
  // each field as a standard labeled control.
  const inlineLayout = layout === "sidebar";
  // A revision keeps the source part number — lock that field (only) for it.
  const lockPartNumber = changeType === "Revision";
  const { t } = useLingui();
  const params = useParams();
  const itemId = data?.itemId ?? params.itemId;
  if (!itemId) throw new Error("itemId not found");

  const sharedPartsData = useRouteData<{ locations: ListItem[] }>(
    path.to.partRoot
  );
  // When `data` is injected (subassembly context), this hook won't match a
  // route and returns undefined — harmless, hooks must be called unconditionally.
  const routeDataFromRoute = useRouteData<{
    partSummary: PartSummary;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    pickMethods: PickMethod[];
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
    tags: { name: string }[];
    supersession?: {
      successorItemId: string | null;
      successorEffectivityDate: string | null;
      successor: {
        id: string;
        readableIdWithRevision: string;
        name: string;
      } | null;
    } | null;
    supersededBy?: Array<{
      predecessor: {
        id: string;
        readableIdWithRevision: string;
        name: string;
      } | null;
    }>;
  }>(path.to.part(itemId));
  const routeData = data ?? routeDataFromRoute;

  const locations = data?.locations ?? sharedPartsData?.locations ?? [];
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (
      field:
        | "active"
        | "defaultMethodType"
        | "sourcingType"
        | "itemTrackingType"
        | "itemPostingGroupId"
        | "partId"
        | "name"
        | "description"
        | "mpn"
        | "replenishmentSystem"
        | "unitOfMeasureCode"
        | "requiresInspection",
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

    [routeData?.partSummary?.id]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
        action: path.to.tags
      });
    },

    [routeData?.partSummary?.readableId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.partSummary?.readableId ?? "");
      formData.append("table", "part");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [routeData?.partSummary?.readableId]
  );

  const [suppliers] = useSuppliers();

  // Image + files, factored so they can render inline ("all") or as the sole
  // content of the "files" section without duplicating the markup.
  const thumbnail = (
    <ItemThumbnailUpload
      path={routeData?.partSummary?.thumbnailPath}
      itemId={itemId}
      modelId={routeData?.partSummary?.modelId}
      isReadOnly={isReadOnly}
    />
  );
  const filesBlock = (
    <VStack spacing={2}>
      <HStack className="w-full justify-between">
        <h3 className="text-xs text-muted-foreground">
          <Trans>Files</Trans>
        </h3>
      </HStack>
      {routeData?.partSummary?.modelId && (
        <Link
          className="group flex items-center gap-1"
          to={path.to.file.cadModel(routeData?.partSummary.modelId)}
          target="_blank"
        >
          <Badge variant="secondary">
            <LuMove3D className="w-3 h-3 mr-1 text-emerald-500" />
            <Trans>3D Model</Trans>
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
  );

  const formLayout = layout === "form";
  // Blocks that hold a wide control (textarea / badge list / custom fields)
  // shouldn't be squeezed into a single grid column — span the full row.
  const spanFull = formLayout ? "sm:col-span-2" : undefined;

  // Part ID (readable id) + name — both editable inline, same as the part
  // detail page. On the CO card these edit the draft item. Extracted so the
  // form + sidebar layouts share the same fields.
  const partIdField = (
    <ValidatedForm
      defaultValues={{
        partId: routeData?.partSummary?.readableIdWithRevision ?? undefined
      }}
      validator={z.object({
        partId: z.string()
      })}
      className={cn("w-full", !formLayout && "-mt-2")}
      isReadOnly={isReadOnly || lockPartNumber}
    >
      <span className="text-sm">
        <InputControlled
          label={formLayout ? t`Part Number` : ""}
          name="partId"
          inline={inlineLayout}
          value={routeData?.partSummary?.readableId ?? ""}
          onBlur={(e) => {
            onUpdate("partId", e.target.value ?? null);
          }}
          className="text-muted-foreground"
        />
      </span>
    </ValidatedForm>
  );
  const nameField = (
    <ValidatedForm
      defaultValues={{
        name: routeData?.partSummary?.name ?? undefined
      }}
      validator={z.object({
        name: z.string()
      })}
      className={cn("w-full", !formLayout && "-mt-2")}
      isReadOnly={isReadOnly}
    >
      <span className="text-xs text-muted-foreground">
        <InputControlled
          label={formLayout ? t`Name` : ""}
          name="name"
          inline={inlineLayout}
          characterLimit={40}
          value={routeData?.partSummary?.name ?? ""}
          onBlur={(e) => {
            onUpdate("name", e.target.value ?? null);
          }}
          className="text-muted-foreground"
        />
      </span>
    </ValidatedForm>
  );

  return (
    <div
      className={cn(
        "text-sm w-full",
        formLayout
          ? "grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 items-start"
          : "flex flex-col items-start space-y-4",
        embedded
          ? "px-1 py-2"
          : "w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2"
      )}
    >
      {formLayout ? (
        <>
          {partIdField}
          {nameField}
        </>
      ) : (
        <VStack spacing={2}>
          {/* On the CO affected-item card the tab already reads "Properties" and
              the card title carries the item id — so drop the redundant heading +
              copy affordances there. Part page (non-embedded) is unchanged. */}
          {!embedded && (
            <HStack className="w-full justify-between">
              <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
                <Trans>Properties</Trans>
              </h3>
              <HStack spacing={1}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      aria-label={t`Link`}
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
                    <span>
                      <Trans>Copy link to part</Trans>
                    </span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      aria-label={t`Copy`}
                      size="sm"
                      className="p-1"
                      onClick={() => copyToClipboard(itemId)}
                    >
                      <LuKeySquare className="w-3 h-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>
                      <Trans>Copy part unique identifier</Trans>
                    </span>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      aria-label={t`Copy`}
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
                    <span>
                      <Trans>Copy part number</Trans>
                    </span>
                  </TooltipContent>
                </Tooltip>
              </HStack>
            </HStack>
          )}
          <VStack spacing={1} className="pt-2">
            {partIdField}
            {nameField}
          </VStack>
          {section === "all" && thumbnail}
        </VStack>
      )}

      {/* <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={itemId}
          table="item"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "parts")}
        />
      </VStack> */}

      <ValidatedForm
        defaultValues={{
          itemPostingGroupId:
            routeData?.partSummary?.itemPostingGroupId ?? undefined
        }}
        validator={z.object({
          itemPostingGroupId: z.string().nullable().optional()
        })}
        className="w-full"
        isReadOnly={isReadOnly}
      >
        <ItemPostingGroup
          label={t`Item Group`}
          name="itemPostingGroupId"
          inline={inlineLayout}
          isClearable
          onChange={(value) => {
            onUpdate("itemPostingGroupId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          replenishmentSystem:
            routeData?.partSummary?.replenishmentSystem ?? undefined
        }}
        validator={z.object({
          replenishmentSystem: z.string()
        })}
        className="w-full"
        isReadOnly={isReadOnly}
      >
        <Select
          name="replenishmentSystem"
          label={t`Replenishment`}
          termId="replenishment-system"
          inline={
            inlineLayout
              ? (value) => (
                  <Badge variant="secondary">
                    <ReplenishmentSystemIcon type={value} className="mr-2" />
                    <span>
                      {value === "Buy"
                        ? t`Buy`
                        : value === "Make"
                          ? t`Make`
                          : t`Buy and Make`}
                    </span>
                  </Badge>
                )
              : undefined
          }
          options={itemReplenishmentSystems.map((system) => ({
            value: system,
            label: (
              <span className="flex items-center gap-2">
                <ReplenishmentSystemIcon type={system} />
                {system === "Buy"
                  ? t`Buy`
                  : system === "Make"
                    ? t`Make`
                    : t`Buy and Make`}
              </span>
            )
          }))}
          onChange={(value) => {
            onUpdate("replenishmentSystem", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          itemTrackingType:
            routeData?.partSummary?.itemTrackingType ?? undefined
        }}
        validator={z.object({
          itemTrackingType: z.string()
        })}
        className="w-full"
        isReadOnly={isReadOnly}
      >
        <Select
          name="itemTrackingType"
          label={t`Tracking Type`}
          termId="item-tracking-type"
          inline={
            inlineLayout
              ? (value) => (
                  <Badge variant="secondary">
                    <TrackingTypeIcon type={value} className="mr-2" />
                    <span>
                      {value === "Inventory"
                        ? t`Inventory`
                        : value === "Non-Inventory"
                          ? t`Non-Inventory`
                          : value === "Serial"
                            ? t`Serial`
                            : t`Batch`}
                    </span>
                  </Badge>
                )
              : undefined
          }
          options={itemTrackingTypes.map((type) => ({
            value: type,
            label: (
              <span className="flex items-center gap-2">
                <TrackingTypeIcon type={type} />
                {type === "Inventory"
                  ? t`Inventory`
                  : type === "Non-Inventory"
                    ? t`Non-Inventory`
                    : type === "Serial"
                      ? t`Serial`
                      : t`Batch`}
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
            routeData?.partSummary?.defaultMethodType ?? undefined
        }}
        validator={z.object({
          defaultMethodType: z.string()
        })}
        className="w-full"
        isReadOnly={isReadOnly}
      >
        <Select
          name="defaultMethodType"
          label={t`Default Method Type`}
          termId="item-default-method-type"
          inline={
            inlineLayout
              ? (value) => (
                  <Badge variant="secondary">
                    <MethodIcon type={value} className="mr-2" />
                    <span>
                      {value === "Purchase to Order"
                        ? t`Purchase to Order`
                        : value === "Pull from Inventory"
                          ? t`Pull from Inventory`
                          : t`Make to Order`}
                    </span>
                  </Badge>
                )
              : undefined
          }
          options={methodType
            .filter((type) => {
              const replenishment = routeData?.partSummary?.replenishmentSystem;
              if (replenishment === "Buy") return type !== "Make to Order";
              if (replenishment === "Make") return type !== "Purchase to Order";
              return true;
            })
            .map((type) => ({
              value: type,
              label: (
                <span className="flex items-center gap-2">
                  <MethodIcon type={type} />
                  {type === "Purchase to Order"
                    ? t`Purchase to Order`
                    : type === "Pull from Inventory"
                      ? t`Pull from Inventory`
                      : t`Make to Order`}
                </span>
              )
            }))}
          onChange={(value) => {
            onUpdate("defaultMethodType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <SourcingTypeProperty
        replenishmentSystem={routeData?.partSummary?.replenishmentSystem}
        value={routeData?.partSummary?.sourcingType}
        inline={inlineLayout}
        isReadOnly={isReadOnly}
        onChange={(value) => onUpdate("sourcingType", value)}
      />

      <ValidatedForm
        defaultValues={{
          unitOfMeasureCode:
            routeData?.partSummary?.unitOfMeasureCode ?? undefined
        }}
        validator={z.object({
          unitOfMeasureCode: z
            .string()
            .min(1, { message: "Unit of Measure is required" })
        })}
        className="w-full"
        isReadOnly={isReadOnly}
      >
        <UnitOfMeasure
          label={t`Unit of Measure`}
          name="unitOfMeasureCode"
          inline={inlineLayout}
          onChange={(value) => {
            onUpdate("unitOfMeasureCode", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <div className={cn("w-full", spanFull)}>
        <ItemDescription
          value={routeData?.partSummary?.description ?? ""}
          inline={inlineLayout}
          isReadOnly={isReadOnly}
          onChange={(value) => onUpdate("description", value)}
        />
      </div>

      <VStack spacing={2} className={spanFull}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">
            <Trans>Methods</Trans>
          </h3>
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
                        type="Make to Order"
                        text={`Version ${method.version}`}
                        to={`${path.to.partDetails(itemId)}?methodId=${method.id}`}
                        className={isActive ? undefined : "opacity-50"}
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
              type="Purchase to Order"
              text={
                suppliers.find((s) => s.id === method.supplierId)?.name ?? ""
              }
              to={path.to.partPurchasing(itemId)}
            />
          ))}
        {pickMethods.map((method) => (
          <MethodBadge
            key={method.locationId}
            type="Pull from Inventory"
            text={locations.find((l) => l.id === method.locationId)?.name ?? ""}
            to={path.to.partInventoryLocation(itemId, method.locationId)}
          />
        ))}
      </VStack>
      {/* Active is a lifecycle flag the change order controls at release — not a
          user-editable attribute in the CO card. Keep it on the part page only. */}
      {!embedded && (
        <ValidatedForm
          defaultValues={{
            active: routeData?.partSummary?.active ?? undefined
          }}
          validator={z.object({
            active: zfd.checkbox()
          })}
          className="w-full"
          isReadOnly={isReadOnly}
        >
          <Boolean
            label={t`Active`}
            name="active"
            variant="small"
            onChange={(value) => {
              onUpdate("active", value ? "on" : "off");
            }}
          />
        </ValidatedForm>
      )}
      {/* Requires Inspection + Manufacturer Part Number are purchasing
          attributes — hidden on the CO affected-item card; they stay editable on
          the part page (non-embedded), same as Active/Tags above. */}
      {!embedded &&
        routeData?.partSummary?.replenishmentSystem?.includes("Buy") && (
          <ValidatedForm
            defaultValues={{
              requiresInspection:
                routeData?.partSummary?.requiresInspection ?? false
            }}
            validator={z.object({
              requiresInspection: zfd.checkbox()
            })}
            className="w-full"
            isReadOnly={isReadOnly}
          >
            <Boolean
              label={t`Requires Inspection`}
              name="requiresInspection"
              variant="small"
              onChange={(value) => {
                onUpdate("requiresInspection", value ? "on" : "off");
              }}
            />
          </ValidatedForm>
        )}
      {!embedded &&
        routeData?.partSummary?.replenishmentSystem?.includes("Buy") && (
          <ValidatedForm
            defaultValues={{
              mpn: routeData?.partSummary?.mpn ?? undefined
            }}
            validator={z.object({
              mpn: z.string().optional()
            })}
            className="w-full"
            isReadOnly={isReadOnly}
          >
            <InputControlled
              label={t`Manufacturer Part Number`}
              name="mpn"
              inline={inlineLayout}
              size="sm"
              value={routeData?.partSummary?.mpn ?? ""}
              onBlur={(e) => {
                onUpdate("mpn", e.target.value ?? null);
              }}
            />
          </ValidatedForm>
        )}
      {routeDataFromRoute?.supersession?.successor && (
        <div className="w-full">
          <h3 className="text-xs text-muted-foreground mb-1">
            <Trans>Superseded By</Trans>
          </h3>
          <Link
            to={path.to.part(routeDataFromRoute.supersession.successor.id)}
            className="text-sm text-primary hover:underline"
          >
            {routeDataFromRoute.supersession.successor.readableIdWithRevision}
          </Link>
          {routeDataFromRoute.supersession.successorEffectivityDate && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                From {routeDataFromRoute.supersession.successorEffectivityDate}
              </Trans>
            </p>
          )}
        </div>
      )}
      {(routeDataFromRoute?.supersededBy?.length ?? 0) > 0 && (
        <div className="w-full">
          <h3 className="text-xs text-muted-foreground mb-1">
            <Trans>Supersedes</Trans>
          </h3>
          {routeDataFromRoute?.supersededBy?.map(
            (ref) =>
              ref.predecessor && (
                <Link
                  key={ref.predecessor.id}
                  to={path.to.part(ref.predecessor.id)}
                  className="block text-sm text-primary hover:underline"
                >
                  {ref.predecessor.readableIdWithRevision}
                </Link>
              )
          )}
        </div>
      )}
      {/* Tags live on the part row, keyed by readableId — shared across all
          revisions. Editing them on a CO draft isn't isolated (it'd change the
          live part now) and can't be diffed per-revision, so hide them here.
          They remain editable on the part page. */}
      {!embedded && (
        <ValidatedForm
          defaultValues={{
            tags: routeData?.partSummary?.tags ?? []
          }}
          validator={z.object({
            tags: z.array(z.string()).optional()
          })}
          className="w-full"
          isReadOnly={isReadOnly}
        >
          <Tags
            availableTags={routeData?.tags ?? []}
            label={t`Tags`}
            name="tags"
            table="part"
            inline
            onChange={onUpdateTags}
          />
        </ValidatedForm>
      )}

      <div className={cn("w-full", spanFull)}>
        <CustomFormInlineFields
          customFields={
            (routeData?.partSummary?.customFields ?? {}) as Record<string, Json>
          }
          table="part"
          tags={routeData?.partSummary?.tags ?? []}
          isDisabled={isReadOnly}
          onUpdate={onUpdateCustomFields}
        />
      </div>

      {section === "all" && filesBlock}
    </div>
  );
};

export default PartProperties;
