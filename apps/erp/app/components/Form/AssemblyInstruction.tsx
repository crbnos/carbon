// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { HStack } from "@carbon/react";
import { useMemo } from "react";
import type { getAssemblyInstructionsForItem } from "~/modules/production/production.service";
import AssemblyInstructionStatus from "~/modules/production/ui/Assemblies/AssemblyInstructionStatus";
import { path } from "~/utils/path";

type AssemblyInstructionSelectProps = Omit<ComboboxProps, "options"> & {
  itemId?: string;
};

const AssemblyInstruction = ({
  itemId,
  ...props
}: AssemblyInstructionSelectProps) => {
  const { options, loading } = useAssemblyInstructions({ itemId });

  return (
    <Combobox
      options={options}
      isOptional={props?.isOptional ?? true}
      isLoading={loading}
      {...props}
      label={props?.label ?? "Assembly Instruction"}
    />
  );
};

AssemblyInstruction.displayName = "AssemblyInstruction";

export default AssemblyInstruction;

export const useAssemblyInstructions = (args: { itemId?: string }) => {
  const { itemId } = args;
  const assemblyInstructionFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getAssemblyInstructionsForItem>>
  >(itemId ? path.to.api.assemblyInstructions(itemId) : null);

  const loading = assemblyInstructionFetcher.isFetching;

  const options = useMemo(
    () =>
      itemId && assemblyInstructionFetcher.data?.data
        ? assemblyInstructionFetcher.data.data.map((c) => ({
            value: c.id,
            label: (
              <div className="flex justify-between items-center gap-1 w-full">
                <HStack className="items-end">
                  <span className="text-sm truncate">{c.name} </span>
                  <span className="text-xs text-muted-foreground">
                    v{c.version}
                  </span>
                </HStack>
                <AssemblyInstructionStatus status={c.status} />
              </div>
            )
          }))
        : [],
    [assemblyInstructionFetcher.data, itemId]
  );

  return { options, loading };
};
