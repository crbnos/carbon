import { Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { useCallback } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { Tags } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { useTags } from "~/hooks/useTags";
import type { action } from "~/routes/x+/quality-document+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { qualityDocumentStatus } from "../../quality.models";
import type { QualityDocument } from "../../types";
import QualityDocumentStatus from "./QualityDocumentStatus";

function getStatusHelperText(
  hasPending: boolean,
  isArchived: boolean,
  canReopen: boolean
): string | undefined {
  if (!hasPending) return undefined;
  if (isArchived) {
    return canReopen
      ? "Reactivation is pending approval. Use Approve or Reject above, or set to Draft to withdraw."
      : "Reactivation is pending approval. Use Approve or Reject above.";
  }
  return canReopen
    ? "Active is unavailable while an approval is pending. Use Approve or Reject above, or set to Archived or Draft to withdraw."
    : "Active is unavailable while an approval is pending. You can set to Archived to cancel the request.";
}

const QualityDocumentProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    document: QualityDocument;
    tags: Array<{ name: string }>;
    approvalRequest: { id: string } | null;
    canReopen: boolean;
  }>(path.to.qualityDocument(id));

  const hasPendingApproval = !!routeData?.approvalRequest;
  const canReopen = routeData?.canReopen ?? true;
  const currentStatus = routeData?.document?.status ?? null;
  const isArchived = currentStatus === "Archived";
  const statusOptions = hasPendingApproval
    ? qualityDocumentStatus.filter(
        (s) => s !== "Active" && (s !== "Draft" || canReopen)
      )
    : qualityDocumentStatus;
  const statusValue =
    currentStatus && statusOptions.includes(currentStatus)
      ? currentStatus
      : statusOptions[0];
  const statusHelperText = getStatusHelperText(
    hasPendingApproval,
    isArchived,
    canReopen
  );

  const fetcher = useFetcher<typeof action>();

  const onUpdate = useCallback(
    (field: "name" | "status", value: string | null) => {
      const formData = new FormData();
      formData.append("ids", id);
      formData.append("field", field);
      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateQualityDocument
      });
    },
    [id, fetcher]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: id,
    table: "qualityDocument"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.document?.assignee;

  const permissions = usePermissions();

  const { onUpdateTags } = useTags({ id, table: "qualityDocument" });

  const availableTags = routeData?.tags ?? [];

  return (
    <VStack
      spacing={4}
      className="w-[450px] bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
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
                      window.location.origin + path.to.qualityDocument(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to document</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(routeData?.document?.id ?? "")}
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy document unique identifier</span>
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
                    copyToClipboard(routeData?.document?.name ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy document name</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm tracking-tight">
          {routeData?.document?.name}
        </span>
      </VStack>

      <Assignee
        id={id}
        table="qualityDocument"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "quality")}
      />

      <ValidatedForm
        key={`status-form-${id}-${currentStatus ?? "unknown"}`}
        defaultValues={{
          status: statusValue ?? undefined
        }}
        validator={z.object({
          status: z.string().min(1, { message: "Status is required" })
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Select
            label="Status"
            name="status"
            helperText={statusHelperText}
            inline={(value) => (
              <QualityDocumentStatus
                status={value as "Draft" | "Active" | "Archived"}
              />
            )}
            options={statusOptions.map((status) => ({
              value: status,
              label: <QualityDocumentStatus status={status} />
            }))}
            value={statusValue ?? ""}
            onChange={(value) => {
              onUpdate("status", value?.value ?? null);
            }}
          />
        </span>
      </ValidatedForm>
      <ValidatedForm
        defaultValues={{
          tags: routeData?.document?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          label="Tags"
          name="tags"
          table="qualityDocument"
          availableTags={availableTags}
          onChange={(value) => onUpdateTags(value)}
          inline
        />
      </ValidatedForm>
    </VStack>
  );
};

export default QualityDocumentProperties;
