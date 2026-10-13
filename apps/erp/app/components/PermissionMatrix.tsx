// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import {
  Checkbox,
  LabelWithHelp,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { UsePermissionMatrixReturn } from "~/hooks/usePermissionMatrix";
import { capitalize } from "~/utils/string";

type PermissionMatrixProps = {
  /** The return value from usePermissionMatrix */
  matrix: UsePermissionMatrixReturn;
  /** Optional section label (default: "Permissions") */
  label?: string;
  termId?: TermId;
  /** Whether to disable all permission checkboxes (e.g., when user lacks edit permission) */
  isDisabled?: boolean;
};

const PermissionMatrix = ({
  matrix,
  label,
  termId,
  isDisabled
}: PermissionMatrixProps) => {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const resolvedLabel = label ?? t`Permissions`;
  const {
    modules,
    actions,
    isChecked,
    toggleCell,
    toggleRow,
    toggleAll,
    allChecked,
    someChecked,
    isRowAllChecked,
    isRowIndeterminate,
    hasAction
  } = matrix;

  return (
    <div className="w-full">
      {resolvedLabel && (
        <label className="block text-sm font-medium leading-none mb-2">
          <LabelWithHelp termId={termId}>{resolvedLabel}</LabelWithHelp>
        </label>
      )}
      {/* Compact: this div scrolls sideways and the module column stays pinned. */}
      <div className="rounded-md border overflow-hidden max-md:overflow-x-auto max-md:scroll-fade-x">
        <Table full={isPhone}>
          <Thead>
            <Tr>
              <Th className="w-[140px] max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card">
                <div className="flex items-center gap-2">
                  <Checkbox
                    isChecked={allChecked}
                    isIndeterminate={someChecked && !allChecked}
                    disabled={isDisabled}
                    onCheckedChange={() => toggleAll()}
                  />
                  <span>
                    <Trans>Module</Trans>
                  </span>
                </div>
              </Th>
              {actions.map((action) => (
                <Th key={action} className="w-[80px] text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span>{capitalize(action)}</span>
                  </div>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {modules.map(([mod]) => (
              <Tr key={mod}>
                <Td className="max-md:sticky max-md:left-0 max-md:z-10 max-md:bg-card">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      isChecked={isRowAllChecked(mod)}
                      isIndeterminate={isRowIndeterminate(mod)}
                      disabled={isDisabled}
                      onCheckedChange={() => toggleRow(mod)}
                    />
                    <span className="text-sm font-medium">
                      {capitalize(mod)}
                    </span>
                  </div>
                </Td>
                {actions.map((action) => (
                  <Td key={action} className="text-center">
                    {hasAction(mod, action) ? (
                      <Checkbox
                        isChecked={isChecked(mod, action)}
                        disabled={isDisabled}
                        onCheckedChange={() => toggleCell(mod, action)}
                      />
                    ) : (
                      <span className="text-muted-foreground pl-6 block">
                        --
                      </span>
                    )}
                  </Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
};

export default PermissionMatrix;
