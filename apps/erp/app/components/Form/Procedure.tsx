import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { HStack, useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getProceduresList } from "~/modules/production/production.service";
import ProcedureStatus from "~/modules/production/ui/Procedures/ProcedureStatus";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type ProcedureSelectProps = Omit<ComboboxProps, "options"> & {
  processId?: string;
  isConfigured?: boolean;
  onConfigure?: () => void;
};

const Procedure = (props: ProcedureSelectProps) => {
  const { options, loading } = useProcedures({
    processId: props?.processId
  });

  const emptyMessage = useEmptyState("procedure");

  return (
    <>
      <Combobox
        options={options}
        isOptional={props?.isOptional ?? true}
        isLoading={loading}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Procedure"}
      />
    </>
  );
};

Procedure.displayName = "Procedure";

export default Procedure;

export const useProcedures = (args: { processId?: string }) => {
  const { processId } = args;
  const procedureFetcher =
    useFetcher<Awaited<ReturnType<typeof getProceduresList>>>();

  useMount(() => {
    procedureFetcher.load(path.to.api.procedures);
  });

  const loading = procedureFetcher.state !== "idle";

  const options = useMemo(
    () =>
      procedureFetcher.data?.data
        ? procedureFetcher.data?.data
            .filter((f) => {
              if (processId) {
                return f.processId === processId;
              }

              return true;
            })
            .map((c) => ({
              value: c.id!,
              label: (
                <div className="flex justify-between items-center gap-1 w-full">
                  <HStack className="items-end">
                    <span className="text-sm truncate">{c.name} </span>
                    <span className="text-xs text-muted-foreground">
                      v{c.version}
                    </span>
                  </HStack>
                  <ProcedureStatus
                    status={c.status as "Active" | "Draft" | "Archived"}
                  />
                </div>
              )
            }))
        : [],
    [procedureFetcher.data, processId]
  );

  return { options, loading };
};
