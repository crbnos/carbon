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
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useEffect } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { Await, Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { MethodBadge, MethodIcon } from "~/components";
import { Boolean, ItemPostingGroup, Tags } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { ItemThumbnailUpload } from "~/components/ItemThumnailUpload";
import { useRouteData } from "~/hooks";
import { methodType } from "~/modules/shared";
import type { action } from "~/routes/x+/items+/update";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { serviceReplenishmentSystems } from "../../items.models";
import type { ItemFile, MakeMethod, Service, SupplierPart } from "../../types";
import { FileBadge, ItemDescription } from "../Item";

type ServicePropertiesProps = {
  data?: {
    itemId: string;
    serviceSummary: Service;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
    makeMethods: Promise<PostgrestResponse<MakeMethod>>;
    tags: { name: string }[];
  };
};

const ServiceProperties = ({ data }: ServicePropertiesProps) => {
  const { t } = useLingui();
  const params = useParams();
  const itemId = data?.itemId ?? params.itemId;
  if (!itemId) throw new Error("itemId not found");

  // When `data` is injected, this hook won't match a route and returns
  // undefined — harmless, hooks must be called unconditionally.
  const routeDataFromRoute = useRouteData<{
    serviceSummary: Service;
    files: Promise<ItemFile[]>;
    supplierParts: SupplierPart[];
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
  }>(path.to.service(itemId));
  const routeData = data ?? routeDataFromRoute;

  const supplierParts = routeData?.supplierParts ?? [];

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
        | "description"
        | "replenishmentSystem"
        | "defaultMethodType"
        | "itemPostingGroupId"
        | "serviceId"
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

      formData.append("ids", routeData?.serviceSummary?.readableId ?? "");
      formData.append("table", "service");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },

    [routeData?.serviceSummary?.readableId]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", routeData?.serviceSummary?.readableId ?? "");
      formData.append("table", "service");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [routeData?.serviceSummary?.readableId]
  );

  const [suppliers] = useSuppliers();

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
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
                      window.location.origin + path.to.service(itemId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to service</Trans>
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
                    copyToClipboard(routeData?.serviceSummary?.id ?? "")
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy service unique identifier</Trans>
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
                      routeData?.serviceSummary?.readableIdWithRevision ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy service number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={1} className="pt-2">
          <ValidatedForm
            defaultValues={{
              serviceId:
                routeData?.serviceSummary?.readableIdWithRevision ?? undefined
            }}
            validator={z.object({
              serviceId: z.string()
            })}
            className="w-full -mt-2"
          >
            <span className="text-sm">
              <InputControlled
                label=""
                name="serviceId"
                inline
                size="sm"
                value={routeData?.serviceSummary?.readableId ?? ""}
                onBlur={(e) => {
                  onUpdate("serviceId", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
          <ValidatedForm
            defaultValues={{
              name: routeData?.serviceSummary?.name ?? undefined
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
                characterLimit={40}
                value={routeData?.serviceSummary?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
        <ItemThumbnailUpload
          path={routeData?.serviceSummary?.thumbnailPath}
          itemId={itemId}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{
          itemPostingGroupId:
            routeData?.serviceSummary?.itemPostingGroupId ?? undefined
        }}
        validator={z.object({
          itemPostingGroupId: z.string().nullable().optional()
        })}
        className="w-full"
      >
        <ItemPostingGroup
          label={t`Item Group`}
          name="itemPostingGroupId"
          inline
          isClearable
          onChange={(value) => {
            onUpdate("itemPostingGroupId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          replenishmentSystem:
            routeData?.serviceSummary?.replenishmentSystem ?? undefined
        }}
        validator={z.object({
          replenishmentSystem: z.string()
        })}
        className="w-full"
      >
        <Select
          name="replenishmentSystem"
          label={t`Replenishment`}
          termId="replenishment-system"
          inline={(value) => (
            <Badge variant="secondary">
              <ReplenishmentSystemIcon type={value} className="mr-2" />
              <span>{value === "Buy" ? t`Buy` : t`Make`}</span>
            </Badge>
          )}
          options={serviceReplenishmentSystems.map((system) => ({
            value: system,
            label: (
              <span className="flex items-center gap-2">
                <ReplenishmentSystemIcon type={system} />
                {system === "Buy" ? t`Buy` : t`Make`}
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
          defaultMethodType:
            routeData?.serviceSummary?.defaultMethodType ?? undefined
        }}
        validator={z.object({
          defaultMethodType: z.string()
        })}
        className="w-full"
      >
        <Select
          name="defaultMethodType"
          label={t`Default Method Type`}
          termId="item-default-method-type"
          inline={(value) => (
            <Badge variant="secondary">
              <MethodIcon type={value} className="mr-2" />
              <span>
                {value === "Purchase to Order"
                  ? t`Purchase to Order`
                  : t`Make to Order`}
              </span>
            </Badge>
          )}
          options={methodType
            .filter((type) => {
              const replenishment =
                routeData?.serviceSummary?.replenishmentSystem;
              if (replenishment === "Buy") return type === "Purchase to Order";
              if (replenishment === "Make") return type === "Make to Order";
              return type !== "Pull from Inventory";
            })
            .map((type) => ({
              value: type,
              label: (
                <span className="flex items-center gap-2">
                  <MethodIcon type={type} />
                  {type === "Purchase to Order"
                    ? t`Purchase to Order`
                    : t`Make to Order`}
                </span>
              )
            }))}
          onChange={(value) => {
            onUpdate("defaultMethodType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Unit of Measure</Trans>
        </h3>
        {routeData?.serviceSummary?.unitOfMeasure && (
          <Badge variant="secondary">
            {routeData.serviceSummary.unitOfMeasure}
          </Badge>
        )}
      </VStack>

      <ItemDescription
        value={routeData?.serviceSummary?.description ?? ""}
        onChange={(value) => onUpdate("description", value)}
      />

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">
            <Trans>Methods</Trans>
          </h3>
        </HStack>
        {routeData?.serviceSummary?.replenishmentSystem?.includes("Make") && (
          <Suspense fallback={null}>
            <Await resolve={routeData?.makeMethods}>
              {(makeMethods) =>
                makeMethods.data
                  ?.sort((a, b) => b.version - a.version)
                  .map((method) => {
                    return (
                      <MethodBadge
                        key={method.id}
                        type="Make to Order"
                        text={`Version ${method.version}`}
                        to={`${path.to.serviceDetails(itemId)}?methodId=${method.id}`}
                      />
                    );
                  })
              }
            </Await>
          </Suspense>
        )}
        {routeData?.serviceSummary?.replenishmentSystem?.includes("Buy") &&
          supplierParts.map((method) => (
            <MethodBadge
              key={method.id}
              type="Purchase to Order"
              text={
                suppliers.find((s) => s.id === method.supplierId)?.name ?? ""
              }
              to={path.to.servicePurchasing(itemId)}
            />
          ))}
      </VStack>
      <ValidatedForm
        defaultValues={{
          active: routeData?.serviceSummary?.active ?? undefined
        }}
        validator={z.object({
          active: zfd.checkbox()
        })}
        className="w-full"
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
      {routeDataFromRoute?.supersession?.successor && (
        <div className="w-full">
          <h3 className="text-xs text-muted-foreground mb-1">
            <Trans>Superseded By</Trans>
          </h3>
          <Link
            to={path.to.service(routeDataFromRoute.supersession.successor.id)}
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
                  to={path.to.service(ref.predecessor.id)}
                  className="block text-sm text-primary hover:underline"
                >
                  {ref.predecessor.readableIdWithRevision}
                </Link>
              )
          )}
        </div>
      )}
      <ValidatedForm
        defaultValues={{
          tags: routeData?.serviceSummary?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          label={t`Tags`}
          name="tags"
          availableTags={routeData?.tags ?? []}
          table="service"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.serviceSummary?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="service"
        tags={routeData?.serviceSummary?.tags ?? []}
        onUpdate={onUpdateCustomFields}
      />

      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">
            <Trans>Files</Trans>
          </h3>
        </HStack>

        <Suspense fallback={null}>
          <Await resolve={routeData?.files}>
            {(files) =>
              files?.map((file) => (
                <FileBadge
                  key={file.id}
                  file={file}
                  itemId={itemId}
                  itemType="Service"
                />
              ))
            }
          </Await>
        </Suspense>
      </VStack>
    </VStack>
  );
};

export default ServiceProperties;
