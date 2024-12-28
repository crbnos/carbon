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
  useMount,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Employees, Hidden, Radios, Submit } from "~/components/Form";
import type { CompanyPermission } from "~/modules/users";
import { bulkPermissionsValidator } from "~/modules/users";
import { path } from "~/utils/path";
import PermissionCheckboxes from "../components/Permission";

type BulkEditPermissionsProps = {
  userIds: string[];
  isOpen: boolean;
  onClose: () => void;
};

const BulkEditPermissions = ({
  userIds,
  isOpen,
  onClose,
}: BulkEditPermissionsProps) => {
  const [permissions, setPermissions] = useState<
    Record<string, CompanyPermission>
  >({});

  const updatePermissions = (module: string, permission: CompanyPermission) => {
    setPermissions((prevPermissions) => ({
      ...prevPermissions,
      [module]: permission,
    }));
  };

  const emptyPermissionsFetcher = useFetcher<{
    permissions: Record<
      string,
      {
        name: string;
        permission: CompanyPermission;
      }
    >;
  }>();

  useMount(() => {
    emptyPermissionsFetcher.load(path.to.api.emptyPermissions);
  });

  useEffect(() => {
    if (emptyPermissionsFetcher.data) {
      let emptyPermissions: Record<string, CompanyPermission> = {};
      Object.entries(emptyPermissionsFetcher.data.permissions).forEach(
        ([module, data]) => {
          emptyPermissions[module] = data.permission;
        }
      );
      setPermissions(emptyPermissions);
    }
  }, [emptyPermissionsFetcher.data]);

  return (
    <Drawer
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={isOpen}
    >
      <DrawerContent>
        <ValidatedForm
          validator={bulkPermissionsValidator}
          method="post"
          action={path.to.bulkEditPermissions}
          onSubmit={onClose}
          defaultValues={{ userIds }}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>Edit Permissions</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <div className="border border-border p-4 w-full rounded-lg">
                <Radios
                  name="editType"
                  label="Type of Permission Update"
                  options={[
                    {
                      label: "Add Permissions",
                      value: "add",
                    },
                    {
                      label: "Update Permissions",
                      value: "update",
                    },
                  ]}
                />
              </div>

              <Employees
                name="userIds"
                selectionsMaxHeight={"calc(100vh - 330px)"}
                label="Users to Update"
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

export default BulkEditPermissions;
