"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
} from "@carbon/react";
import { useFetchers, useParams, useSubmit } from "@remix-run/react";
import { useCallback } from "react";
import { OperationStatusIcon } from "~/components/Icons";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { jobOperationStatus } from "../../production.models";
import type { Job, JobOperation } from "../../types";
import { z } from "zod";
import { ValidatedForm } from "@carbon/form";
import { Tags } from "~/components/Form";
import { useTags } from "~/hooks/useTags";

function useOptimisticJobStatus(operationId: string) {
  const fetchers = useFetchers();
  const pendingUpdate = fetchers.find(
    (f) =>
      f.formData?.get("id") === operationId &&
      f.key === `jobOperation:${operationId}`
  );
  return pendingUpdate?.formData?.get("status") as
    | JobOperation["status"]
    | undefined;
}

export function JobOperationStatus({
  operation,
  className,
  onChange,
}: {
  operation: { id?: string; status: JobOperation["status"]; jobId?: string };
  className?: string;
  onChange?: (status: JobOperation["status"]) => void;
}) {
  const params = useParams();
  const jobId = params.jobId ?? operation.jobId;
  if (!jobId) throw new Error("Job ID is required");

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const isPaused = routeData?.job?.status === "Paused";
  const submit = useSubmit();
  const permissions = usePermissions();
  const optimisticStatus = useOptimisticJobStatus(operation.id!);

  const isDisabled = !permissions.can("update", "production");

  const onOperationStatusChange = useCallback(
    (id: string, status: JobOperation["status"]) => {
      onChange?.(status);
      submit(
        {
          id,
          status,
        },
        {
          method: "post",
          action: path.to.jobOperationStatus,
          navigate: false,
          fetcherKey: `jobOperation:${id}`,
        }
      );
    },
    [submit, onChange]
  );

  const currentStatus =
    optimisticStatus || (isPaused ? "Paused" : operation.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="sm"
          variant="ghost"
          className={className}
          aria-label="Change status"
          icon={<OperationStatusIcon status={currentStatus} />}
          isDisabled={isDisabled}
        />
      </DropdownMenuTrigger>
      {!isDisabled && (
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={currentStatus}
            onValueChange={(status) =>
              onOperationStatusChange(
                operation.id!,
                status as JobOperation["status"]
              )
            }
          >
            {jobOperationStatus.map((status) => (
              <DropdownMenuRadioItem key={status} value={status}>
                <DropdownMenuIcon
                  icon={<OperationStatusIcon status={status} />}
                />
                <span>{status}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

export function JobOperationTags({
  operation,
  availableTags,
}: {
  operation: { id?: string; tags: string[] | null };
  availableTags: { name: string }[];
}) {
  const { onUpdateTags } = useTags({ id: operation.id, table: "jobOperation" });

  if (!operation.id) return null;

  return (
    <ValidatedForm
      defaultValues={{
        tags: operation.tags ?? [],
      }}
      validator={z.object({
        tags: z.array(z.string()).optional(),
      })}
    >
      <Tags
        availableTags={availableTags}
        label=""
        name="tags"
        table="operation"
        maxPreview={3}
        inline
        onChange={onUpdateTags}
      />
    </ValidatedForm>
  );
}
