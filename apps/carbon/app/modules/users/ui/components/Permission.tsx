import { Checkbox, HStack, VStack } from "@carbon/react";
import type { CompanyPermission } from "~/modules/users";
import { capitalize } from "~/utils/string";

type PermissionProps = {
  module: string;
  permissions: CompanyPermission;
  updatePermissions: (module: string, permissions: CompanyPermission) => void;
};

const labels = ["view", "create", "update", "delete"] as const;

const PermissionCheckboxes = ({
  module,
  permissions,
  updatePermissions,
}: PermissionProps) => {
  const allChecked = Object.values(permissions).every(Boolean);
  const isIndeterminate =
    Object.values(permissions).some(Boolean) && !allChecked;

  const updateByPosition = (position: number, value: boolean) => {
    const newPermissions = { ...permissions };
    newPermissions[labels[position]] = value;
    updatePermissions(module, newPermissions);
  };

  if (["messaging", "items", "timecards"].includes(module)) {
    return null;
  }

  return (
    <div>
      <HStack>
        <Checkbox
          isChecked={allChecked || isIndeterminate}
          isIndeterminate={isIndeterminate}
          onCheckedChange={(checked) =>
            updatePermissions(module, {
              view: !!checked,
              create: !!checked,
              update: !!checked,
              delete: !!checked,
            })
          }
        />
        <span>{capitalize(module)}</span>
      </HStack>

      <VStack className="pl-6 mt-2">
        {labels.map((verb, index) => (
          <HStack key={index}>
            <Checkbox
              isChecked={permissions[verb]}
              onCheckedChange={(checked) => updateByPosition(index, !!checked)}
            />
            <span>{`${capitalize(labels[index])} ${capitalize(module)}`}</span>
          </HStack>
        ))}
      </VStack>
    </div>
  );
};

export default PermissionCheckboxes;
