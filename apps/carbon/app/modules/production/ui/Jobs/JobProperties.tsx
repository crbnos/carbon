import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  toast,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useCallback, useEffect, useState } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import { usePermissions, useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";

import {
  DatePicker,
  NumberControlled,
  Select,
  ValidatedForm,
} from "@carbon/form";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Assignee, useOptimisticAssignment } from "~/components";
import { Customer, Item, Location, UnitOfMeasure } from "~/components/Form";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { deadlineTypes } from "../../production.models";
import type { Job } from "../../types";
import { getDeadlineIcon, getDeadlineText } from "./Deadline";

const JobProperties = () => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{
    job: Job;
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
    [fetcher, jobId, routeData?.job]
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

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto border-l border-border px-4 py-2 text-sm"
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
                  onClick={() => copyToClipboard(routeData?.job?.id ?? "")}
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
          type={type}
          validItemTypes={["Part", "Fixture"]}
          onChange={(value) => {
            onUpdate("itemId", value?.value ?? null);
          }}
          onTypeChange={setType}
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
          value={routeData?.job?.scrapQuantity ?? 0}
          onChange={(value) => {
            onUpdate("scrapQuantity", value);
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
                {getDeadlineIcon(deadlineType, false)}
                <span>{getDeadlineText(deadlineType)}</span>
              </div>
            );
          }}
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
          onChange={(value) => {
            if (value?.value) {
              onUpdate("locationId", value.value);
            }
          }}
        />
      </ValidatedForm>
    </VStack>
  );
};

export default JobProperties;
