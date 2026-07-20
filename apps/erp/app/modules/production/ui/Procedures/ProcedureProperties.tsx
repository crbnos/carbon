import { Select, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { LuCopy, LuKeySquare, LuLink } from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { Process, Tags } from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { useTags } from "~/hooks/useTags";
import type { action } from "~/routes/x+/items+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { procedureStatus } from "../../production.models";
import type { Procedure } from "../../types";
import ProcedureStatus from "./ProcedureStatus";

const ProcedureProperties = () => {
  const { id } = useParams();
  const { t } = useLingui();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    procedure: Procedure;
    tags: { name: string }[];
  }>(path.to.procedure(id));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (field: "name" | "processId" | "status", value: string | null) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);

      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateProcedure
      });
    },

    [id]
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: id,
    table: "procedure"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.procedure?.assignee;

  const permissions = usePermissions();

  const { onUpdateTags } = useTags({ id, table: "procedure" });

  return (
    <VStack
      spacing={4}
      className="w-[450px] bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
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
                      window.location.origin + path.to.procedure(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to procedure</Trans>
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
                    copyToClipboard(routeData?.procedure?.id ?? "")
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy procedure unique identifier</Trans>
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
                    copyToClipboard(routeData?.procedure?.name ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy procedure name</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm tracking-tight">
          {routeData?.procedure?.name}
        </span>
      </VStack>

      <Assignee
        id={id}
        table="procedure"
        value={assignee ?? ""}
        variant="inline"
        isReadOnly={!permissions.can("update", "production")}
      />

      <ValidatedForm
        defaultValues={{
          status: routeData?.procedure?.status ?? undefined
        }}
        validator={z.object({
          status: z.string().min(1, { message: "Status is required" })
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Select
            label={t`Status`}
            termId="procedure-status"
            name="status"
            inline={(value) => (
              <ProcedureStatus
                status={value as "Draft" | "Active" | "Archived"}
              />
            )}
            options={procedureStatus.map((status) => ({
              value: status,
              label: <ProcedureStatus status={status} />
            }))}
            value={routeData?.procedure?.status ?? ""}
            onChange={(value) => {
              onUpdate("status", value?.value ?? null);
            }}
          />
        </span>
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          processId: routeData?.procedure?.processId ?? undefined
        }}
        validator={z.object({
          processId: z.string().min(1, { message: "Process is required" })
        })}
        className="w-full"
      >
        <Process
          label={t`Process`}
          name="processId"
          inline
          onChange={(value) => {
            onUpdate("processId", value?.value ?? null);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          tags: routeData?.procedure?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          availableTags={routeData?.tags ?? []}
          label={t`Tags`}
          name="tags"
          table="procedure"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>
    </VStack>
  );
};

export default ProcedureProperties;
