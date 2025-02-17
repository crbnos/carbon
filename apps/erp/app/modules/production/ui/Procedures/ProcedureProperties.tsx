import { Select, ValidatedForm } from "@carbon/form";
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
import { Process } from "~/components/Form";
import { useRouteData } from "~/hooks";
import type { action } from "~/routes/x+/items+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";
import { Procedure } from "../../types";
import ProcedureStatus from "./ProcedureStatus";
import { procedureStatus } from "../../production.models";

const ProcedureProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    procedure: Procedure;
  }>(path.to.procedure(id));

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  const onUpdate = useCallback(
    (field: "name" | "processId" | "status", value: string | null) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);

      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateProcedure,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

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
                      window.location.origin + path.to.procedure(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link to procedure</span>
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
                    copyToClipboard(routeData?.procedure?.id ?? "")
                  }
                >
                  <LuKeySquare className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy procedure unique identifier</span>
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
                    copyToClipboard(routeData?.procedure?.name ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy procedure name</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <span className="text-sm tracking-tight">
          {routeData?.procedure?.name}
        </span>
      </VStack>
      <ValidatedForm
        defaultValues={{
          status: routeData?.procedure?.status ?? undefined,
        }}
        validator={z.object({
          status: z.string().min(1, { message: "Status is required" }),
        })}
        className="w-full"
      >
        <span className="text-sm tracking-tight">
          <Select
            label="Status"
            name="status"
            inline={(value) => (
              <ProcedureStatus
                status={value as "Draft" | "Active" | "Archived"}
              />
            )}
            options={procedureStatus.map((status) => ({
              value: status,
              label: <ProcedureStatus status={status} />,
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
          processId: routeData?.procedure?.processId ?? undefined,
        }}
        validator={z.object({
          processId: z.string().min(1, { message: "Process is required" }),
        })}
        className="w-full"
      >
        <Process
          label="Process"
          name="processId"
          inline
          onChange={(value) => {
            onUpdate("processId", value?.value ?? null);
          }}
        />
      </ValidatedForm>
    </VStack>
  );
};

export default ProcedureProperties;
