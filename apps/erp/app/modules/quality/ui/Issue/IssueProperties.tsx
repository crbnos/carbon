import type { Json } from "@carbon/database";
import {
  DatePicker,
  InputControlled,
  MultiSelect,
  Select,
  ValidatedForm,
} from "@carbon/form";
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
import { useCallback, useEffect } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { z } from "zod";
import { Assignee, useOptimisticAssignment } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { Tags } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import type { ListItem, StorageItem } from "~/types";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import {
  nonConformanceApprovalRequirement,
  nonConformancePriority,
  nonConformanceSource,
} from "../../quality.models";
import type { Issue } from "../../types";
import { getPriorityIcon, getSourceIcon } from "./IssueIcons";

const IssueProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const permissions = usePermissions();

  const routeData = useRouteData<{
    nonConformance: Issue;
    nonConformanceTypes: ListItem[];
    investigationTypes: ListItem[];
    requiredActions: ListItem[];
    files: Promise<StorageItem[]>;
    tags: { name: string }[];
  }>(path.to.issue(id));

  console.log(routeData);

  const optimisticAssignment = useOptimisticAssignment({
    id: id,
    table: "nonConformance",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.nonConformance?.assignee;

  const isStarted = routeData?.nonConformance?.status !== "Registered";

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onUpdate = useCallback(
    (
      field:
        | "source"
        | "priority"
        | "investigationTypeIds"
        | "requiredActionIds"
        | "approvalRequirements"
        | "name"
        | "description"
        | "locationId"
        | "nonConformanceTypeId"
        | "openDate"
        | "dueDate"
        | "closeDate"
        | "quantity"
        | "itemId"
        | "supplierId",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);

      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateIssue,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "nonConformance");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "nonConformance");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  const disableStructureUpdate =
    !permissions.can("delete", "quality") || isStarted;

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
                    copyToClipboard(window.location.origin + path.to.issue(id))
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to issue</span>
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
                      routeData?.nonConformance?.nonConformanceId ?? ""
                    )
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy issue unique identifier</span>
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
                      routeData?.nonConformance?.nonConformanceId ?? ""
                    )
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy issue number</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={0}>
          <span className="text-sm tracking-tight">
            {routeData?.nonConformance?.nonConformanceId}
          </span>
          <ValidatedForm
            defaultValues={{
              name: routeData?.nonConformance?.name ?? undefined,
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
                size="sm"
                inline
                value={routeData?.nonConformance?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">Assignee</h3>
        <Assignee
          id={id}
          table="nonConformance"
          size="sm"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "quality")}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{
          nonConformanceTypeId:
            routeData?.nonConformance?.nonConformanceTypeId ?? "",
        }}
        validator={z.object({
          nonConformanceTypeId: z.string().optional(),
        })}
        className="w-full"
      >
        <Select
          options={(routeData?.nonConformanceTypes ?? []).map((type) => ({
            value: type.id,
            label: <Enumerable value={type.name} />,
          }))}
          isReadOnly={disableStructureUpdate}
          label="Issue Type"
          name="nonConformanceTypeId"
          inline={(value, options) => {
            return (
              <Enumerable
                value={
                  routeData?.nonConformanceTypes.find((t) => t.id === value)
                    ?.name ?? null
                }
              />
            );
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("nonConformanceTypeId", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          source: routeData?.nonConformance?.source ?? "",
        }}
        validator={z.object({
          source: z.string().optional(),
        })}
        className="w-full"
      >
        <Select
          options={nonConformanceSource.map((source) => ({
            value: source,
            label: (
              <div className="flex gap-2 items-center">
                {getSourceIcon(source, false)}
                <span>{source}</span>
              </div>
            ),
          }))}
          isReadOnly={disableStructureUpdate}
          label="Source"
          name="source"
          inline={(value, options) => {
            return (
              <div className="flex gap-2 items-center">
                {getSourceIcon(value as "External" | "Internal", false)}
                <span>{value}</span>
              </div>
            );
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("source", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          priority: routeData?.nonConformance?.priority ?? "",
        }}
        validator={z.object({
          priority: z.string().optional(),
        })}
        className="w-full"
      >
        <Select
          options={nonConformancePriority.map((priority) => ({
            value: priority,
            label: (
              <div className="flex gap-2 items-center">
                {getPriorityIcon(priority, false)}
                <span>{priority}</span>
              </div>
            ),
          }))}
          isReadOnly={disableStructureUpdate}
          label="Priority"
          name="priority"
          inline={(value, options) => {
            return (
              <div className="flex gap-2 items-center">
                {getPriorityIcon(
                  value as "Low" | "Medium" | "High" | "Critical",
                  false
                )}
                <span>{value}</span>
              </div>
            );
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("priority", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          investigationTypeIds:
            routeData?.nonConformance?.investigationTypeIds ?? [],
        }}
        validator={z.object({
          investigationTypeIds: z.array(z.string()).optional(),
        })}
        className="w-full"
      >
        <MultiSelect
          options={(routeData?.investigationTypes ?? []).map((type) => ({
            value: type.id,
            label: type.name,
          }))}
          isReadOnly={disableStructureUpdate}
          label="Investigation Types"
          name="investigationTypeIds"
          inline
          value={routeData?.nonConformance?.investigationTypeIds ?? []}
          onChange={(value) => {
            onUpdate(
              "investigationTypeIds",
              value.map((v) => v.value).join(",")
            );
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          requiredActionIds: routeData?.nonConformance?.requiredActionIds ?? [],
        }}
        validator={z.object({
          requiredActionIds: z.array(z.string()).optional(),
        })}
        className="w-full"
      >
        <MultiSelect
          options={(routeData?.requiredActions ?? []).map((type) => ({
            value: type.id,
            label: type.name,
          }))}
          isReadOnly={disableStructureUpdate}
          label="Required Actions"
          name="requiredActionIds"
          inline
          value={routeData?.nonConformance?.requiredActionIds ?? []}
          onChange={(value) => {
            onUpdate("requiredActionIds", value.map((v) => v.value).join(","));
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          approvalRequirements:
            routeData?.nonConformance?.approvalRequirements ?? [],
        }}
        validator={z.object({
          approvalRequirements: z.array(z.string()).optional(),
        })}
        className="w-full"
      >
        <MultiSelect
          options={nonConformanceApprovalRequirement.map((type) => ({
            value: type,
            label: type,
          }))}
          isReadOnly={disableStructureUpdate}
          label="Approval Requirements"
          name="approvalRequirements"
          inline
          onChange={(value) => {
            onUpdate(
              "approvalRequirements",
              value.map((v) => v.value).join(",")
            );
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          openDate: routeData?.nonConformance?.openDate ?? "",
        }}
        validator={z.object({
          openDate: z.string().min(1, { message: "Open date is required" }),
        })}
        className="w-full"
      >
        <DatePicker
          name="openDate"
          label="Open Date"
          inline
          isDisabled={!permissions.can("update", "quality")}
          onChange={(date) => {
            onUpdate("openDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          dueDate: routeData?.nonConformance?.dueDate ?? "",
        }}
        validator={z.object({
          dueDate: z.string().min(1, { message: "Due date is required" }),
        })}
        className="w-full"
      >
        <DatePicker
          name="dueDate"
          label="Due Date"
          inline
          isDisabled={!permissions.can("update", "quality")}
          onChange={(date) => {
            onUpdate("dueDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          closeDate: routeData?.nonConformance?.closeDate ?? "",
        }}
        validator={z.object({
          closeDate: z.string().min(1, { message: "Close date is required" }),
        })}
        className="w-full"
      >
        <DatePicker
          name="closeDate"
          label="Close Date"
          inline
          isDisabled={!permissions.can("update", "quality")}
          onChange={(date) => {
            onUpdate("closeDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          tags: routeData?.nonConformance?.tags ?? [],
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
          table="nonConformance"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.nonConformance?.customFields ?? {}) as Record<
            string,
            Json
          >
        }
        table="nonConformance"
        tags={routeData?.nonConformance?.tags ?? []}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default IssueProperties;
