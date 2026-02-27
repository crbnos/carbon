import { Checkbox, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import type { UsePermissionMatrixReturn } from "~/hooks/usePermissionMatrix";
import { capitalize } from "~/utils/string";

type PermissionMatrixProps = {
  /** The return value from usePermissionMatrix */
  matrix: UsePermissionMatrixReturn;
  /** Optional section label (default: "Permissions") */
  label?: string;
};

const PermissionMatrix = ({
  matrix,
  label = "Permissions"
}: PermissionMatrixProps) => {
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
      {label && (
        <label className="block text-sm font-medium leading-none mb-2">
          {label}
        </label>
      )}
      <div className="rounded-md border overflow-hidden">
        <Table>
          <Thead>
            <Tr>
              <Th className="w-[140px]">
                <div className="flex items-center gap-2">
                  <Checkbox
                    isChecked={allChecked}
                    isIndeterminate={someChecked && !allChecked}
                    onCheckedChange={() => toggleAll()}
                  />
                  <span>Module</span>
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
                <Td>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      isChecked={isRowAllChecked(mod)}
                      isIndeterminate={isRowIndeterminate(mod)}
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
