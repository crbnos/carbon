import {
  Badge,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  toast,
} from "@carbon/react";
import { Await, useFetcher, useParams } from "@remix-run/react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { LuBox, LuCopy, LuLink, LuUnlink2 } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";

import type { Json } from "@carbon/database";
import {
  DatePicker,
  InputControlled,
  NumberControlled,
  Select,
  ValidatedForm,
} from "@carbon/form";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { RiProgress8Line } from "react-icons/ri";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, Hyperlink, useOptimisticAssignment } from "~/components";
import {
  Customer,
  Item,
  Location,
  Tags,
  UnitOfMeasure,
} from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import type { TrackedEntity } from "~/modules/inventory/types";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { deadlineTypes } from "../../production.models";
import type { Job } from "../../types";
import { getDeadlineIcon } from "./Deadline";

const JobProperties = () => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{
    job: Job;
    tags: { name: string }[];
    trackedEntities: Promise<PostgrestResponse<TrackedEntity>>;
  }>(path.to.job(jobId));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const [type, setType] = useState<MethodItemType>(
    (routeData?.job?.itemType ?? "Part") as MethodItemType
  );

  const onUpdate = useCallback(
    (field: keyof Job, value: string | number | null) => {
      if (value === routeData?.job[field]) {
        return;
      }
      const formData = new FormData();

      formData.append("ids", jobId);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateJob,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobId, routeData?.job]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", jobId);
      formData.append("table", "job");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobId]
  );

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", jobId);
      formData.append("table", "job");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobId]
  );

  const onUpdateBatchNumber = useCallback(
    (trackedEntityId: string, value: string) => {
      const formData = new FormData();

      if (!trackedEntityId) {
        toast.error("Tracked entity ID is required but none was found");
        return;
      }

      formData.append("id", trackedEntityId);
      formData.append("value", value);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.jobBatchNumber(jobId),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const permissions = usePermissions();
  const optimisticAssignment = useOptimisticAssignment({
    id: jobId,
    table: "job",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.job?.assignee;

  const isDisabled =
    !permissions.can("update", "production") ||
    ["Completed", "Cancelled"].includes(routeData?.job?.status ?? "");

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
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
                      window.location.origin + path.to.jobDetails(jobId)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to Job</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(routeData?.job?.jobId ?? "")}
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy Job number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm">{routeData?.job?.jobId}</span>
      </VStack>

      <VStack spacing={2}>
        <Suspense fallback={null}>
          <Await resolve={routeData?.trackedEntities}>
            {(entities) => {
              const trackingType = routeData?.job?.itemTrackingType ?? "";

              if (!["Batch", "Serial"].includes(trackingType)) {
                return null;
              }

              const trackedEntities = entities?.data ?? [];

              return (
                <>
                  {trackedEntities.map((entity, index) => {
                    const trackingNumber: string =
                      // @ts-ignore
                      entity?.attributes?.["Batch Number"]?.toString() ?? "";
                    console.log("trackingNumber", trackingNumber);

                    const label =
                      trackingType === "Serial" && trackedEntities.length > 1
                        ? `${trackingType} ${index + 1}`
                        : `${trackingType} Number`;

                    return (
                      <ValidatedForm
                        key={entity.id}
                        defaultValues={{
                          trackingNumber,
                        }}
                        validator={z.object({
                          trackingNumber: zfd.text(z.string().optional()),
                        })}
                        className="w-full"
                      >
                        <InputControlled
                          name="trackingNumber"
                          label={label}
                          value={trackingNumber}
                          size="sm"
                          inline
                          onBlur={(e) => {
                            onUpdateBatchNumber(entity.id, e.target.value);
                          }}
                        />
                      </ValidatedForm>
                    );
                  })}
                </>
              );
            }}
          </Await>
        </Suspense>

        <span className="text-xs text-muted-foreground">Target</span>
        {routeData?.job?.customerId &&
        routeData?.job?.salesOrderId &&
        routeData?.job?.salesOrderLineId ? (
          <HStack className="group" spacing={1}>
            <Hyperlink
              to={path.to.salesOrderLine(
                routeData.job.salesOrderId,
                routeData?.job.salesOrderLineId
              )}
            >
              <Badge variant="secondary">
                <RiProgress8Line className="w-3 h-3 mr-1" />
                {routeData?.job.salesOrderReadableId ?? "Make to Order"}
              </Badge>
            </Hyperlink>
            <Button
              className="group-hover:opacity-100 opacity-0 transition-opacity duration-200"
              variant="ghost"
              size="sm"
              leftIcon={<LuUnlink2 className="w-3 h-3" />}
              onClick={() => {
                onUpdate("salesOrderLineId", null);
              }}
            >
              Unlink
            </Button>
          </HStack>
        ) : (
          <Badge variant="secondary">
            <LuBox className="w-3 h-3 mr-1" />
            Inventory
          </Badge>
        )}
      </VStack>

      <Assignee
        id={jobId}
        table="job"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "production")}
      />

      <ValidatedForm
        defaultValues={{ itemId: routeData?.job?.itemId ?? undefined }}
        validator={z.object({
          itemId: z.string().min(1, { message: "Item is required" }),
        })}
        className="w-full"
      >
        <Item
          name="itemId"
          inline
          isReadOnly={isDisabled}
          type={type}
          validItemTypes={["Part", "Tool"]}
          onChange={(value) => {
            onUpdate("itemId", value?.value ?? null);
          }}
          onTypeChange={(value) => {
            setType(value as MethodItemType);
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{ quantity: routeData?.job?.quantity ?? undefined }}
        validator={z.object({
          quantity: zfd.numeric(
            z.number().min(0, { message: "Quantity is required" })
          ),
        })}
        className="w-full"
      >
        <NumberControlled
          label="Quantity"
          name="quantity"
          inline
          isReadOnly={isDisabled}
          value={routeData?.job?.quantity ?? 0}
          onChange={(value) => {
            onUpdate("quantity", value);
          }}
        />
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          scrapQuantity: routeData?.job?.scrapQuantity ?? undefined,
        }}
        validator={z.object({
          scrapQuantity: zfd.numeric(
            z.number().min(0, { message: "Quantity is required" })
          ),
        })}
        className="w-full"
      >
        <NumberControlled
          label="Estimated Scrap Quantity"
          name="scrapQuantity"
          inline
          isReadOnly={isDisabled}
          value={routeData?.job?.scrapQuantity ?? 0}
          onChange={(value) => {
            onUpdate("scrapQuantity", value);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          startDate: routeData?.job?.startDate ?? "",
        }}
        validator={z.object({
          startDate: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="startDate"
          label="Start Date"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("startDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          dueDate: routeData?.job?.dueDate ?? "",
        }}
        validator={z.object({
          dueDate: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <DatePicker
          name="dueDate"
          label="Due Date"
          inline
          isDisabled={isDisabled}
          onChange={(date) => {
            onUpdate("dueDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          deadlineType: routeData?.job?.deadlineType ?? "",
        }}
        validator={z.object({
          deadlineType: z
            .string()
            .min(1, { message: "Deadline Type is required" }),
        })}
        className="w-full"
      >
        <Select
          name="deadlineType"
          label="Deadline Type"
          inline={(value, options) => {
            const deadlineType = value as (typeof deadlineTypes)[number];
            return (
              <div className="flex gap-1 items-center">
                {getDeadlineIcon(deadlineType)}
                <span>{deadlineType}</span>
              </div>
            );
          }}
          isReadOnly={isDisabled}
          options={deadlineTypes.map((d) => ({
            value: d,
            label: d,
          }))}
          onChange={(value) => {
            onUpdate("deadlineType", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ customerId: routeData?.job?.customerId ?? undefined }}
        validator={z.object({
          customerId: zfd.text(z.string().optional()),
        })}
        className="w-full"
      >
        <Customer
          name="customerId"
          inline
          isOptional
          isReadOnly={isDisabled || !!routeData?.job?.salesOrderId}
          onChange={(value) => {
            onUpdate("customerId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          unitOfMeasureCode: routeData?.job?.unitOfMeasureCode ?? undefined,
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
          isReadOnly={isDisabled}
          onChange={(value) => {
            onUpdate("unitOfMeasureCode", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{ locationId: routeData?.job?.locationId ?? undefined }}
        validator={z.object({
          locationId: z.string().min(1, { message: "Location is required" }),
        })}
        className="w-full"
      >
        <Location
          label="Job Location"
          name="locationId"
          inline
          isReadOnly={isDisabled}
          onChange={(value) => {
            if (value?.value) {
              onUpdate("locationId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          tags: routeData?.job.tags ?? [],
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
          table="job"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.job?.customFields ?? {}) as Record<string, Json>
        }
        table="job"
        tags={routeData?.job.tags ?? []}
        onUpdate={onUpdateCustomFields}
        isDisabled={isDisabled}
      />
    </VStack>
  );
};

export default JobProperties;
