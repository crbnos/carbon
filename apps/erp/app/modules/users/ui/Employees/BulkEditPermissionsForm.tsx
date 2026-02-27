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
  useMount,
  VStack
} from "@carbon/react";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import { Employees, Hidden, Radios, Submit } from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import {
  fromEmployeeTypePermissions,
  toCompanyPermissions,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import type { CompanyPermission } from "~/modules/users";
import { bulkPermissionsValidator } from "~/modules/users";
import { path } from "~/utils/path";

type BulkEditPermissionsProps = {
  userIds: string[];
  isOpen: boolean;
  onClose: () => void;
};

const BulkEditPermissions = ({
  userIds,
  isOpen,
  onClose
}: BulkEditPermissionsProps) => {
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

  const { state: initialState, modules } = useMemo(() => {
    if (emptyPermissionsFetcher.data) {
      return fromEmployeeTypePermissions(
        emptyPermissionsFetcher.data.permissions
      );
    }
    return { state: {}, modules: {} };
  }, [emptyPermissionsFetcher.data]);

  const matrix = usePermissionMatrix({
    modules,
    initialState
  });

  // When new empty permissions arrive, reset the matrix state
  useEffect(() => {
    if (emptyPermissionsFetcher.data) {
      const { state } = fromEmployeeTypePermissions(
        emptyPermissionsFetcher.data.permissions
      );
      matrix.setPermissions(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyPermissionsFetcher.data]);

  // Serialize permissions to the format expected by the action
  const permissionsData = JSON.stringify(
    toCompanyPermissions(matrix.permissions)
  );

  const hasModules = Object.keys(modules).length > 0;

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
                      value: "add"
                    },
                    {
                      label: "Update Permissions",
                      value: "update"
                    }
                  ]}
                />
              </div>

              <Employees
                name="userIds"
                selectionsMaxHeight={"calc(100vh - 330px)"}
                label="Users to Update"
              />

              {hasModules && <PermissionMatrix matrix={matrix} />}
              <Hidden name="data" value={permissionsData} />
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
