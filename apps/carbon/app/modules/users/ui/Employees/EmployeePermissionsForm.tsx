import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import { Hidden, Select, Submit } from "~/components/Form";
import type { CompanyPermission } from "~/modules/users";
import { employeeValidator } from "~/modules/users";
import PermissionCheckboxes from "~/modules/users/ui/components/Permission";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type EmployeePermissionsFormProps = {
  name: string;
  employeeTypes: ListItem[];
  initialValues: z.infer<typeof employeeValidator> & {
    permissions: Record<string, CompanyPermission>;
  };
};

const EmployeePermissionsForm = ({
  name,
  employeeTypes,
  initialValues,
}: EmployeePermissionsFormProps) => {
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const employeeTypeOptions =
    employeeTypes?.map((et) => ({
      value: et.id,
      label: et.name,
    })) ?? [];

  const [permissions, setPermissions] = useState(initialValues.permissions);
  const updatePermissions = (module: string, permission: CompanyPermission) => {
    setPermissions((prevPermissions) => ({
      ...prevPermissions,
      [module]: permission,
    }));
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={employeeValidator}
          method="post"
          action={path.to.employeeAccount(initialValues.id)}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{name}</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Select
                name="employeeType"
                label="Employee Type"
                options={employeeTypeOptions}
                placeholder="Select Employee Type"
              />
              <label className="block text-sm font-medium leading-none">
                Permissions
              </label>
              <VStack spacing={8}>
                {Object.entries(permissions)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([module, data], index) => (
                    <div key={index}>
                      <PermissionCheckboxes
                        module={module}
                        permissions={data}
                        updatePermissions={updatePermissions}
                      />
                    </div>
                  ))}
              </VStack>
              <Hidden name="id" />
              <Hidden name="data" value={JSON.stringify(permissions)} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default EmployeePermissionsForm;
