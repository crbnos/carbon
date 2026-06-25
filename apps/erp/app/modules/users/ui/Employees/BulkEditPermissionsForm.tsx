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
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
  }, [emptyPermissionsFetcher.data, matrix.setPermissions]);

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
            <DrawerTitle>
              <Trans>Edit Permissions</Trans>
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <div className="border border-border p-4 w-full rounded-lg">
                <Radios
                  name="editType"
                  label={t`Type of Permission Update`}
                  termId="bulk-permissions-update-type"
                  options={[
                    {
                      label: t`Add Permissions`,
                      value: "add"
                    },
                    {
                      label: t`Update Permissions`,
                      value: "update"
                    }
                  ]}
                />
              </div>

              <Employees
                name="userIds"
                selectionsMaxHeight={"calc(100vh - 330px)"}
                label={t`Users to Update`}
              />

              {hasModules && <PermissionMatrix matrix={matrix} />}
              <Hidden name="data" value={permissionsData} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default BulkEditPermissions;
