// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ValidatedForm } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { Employees, Hidden, Radios, Submit } from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import {
  type AllMatchingSelection,
  allMatchingRequest
} from "~/components/Table";
import { usePermissions } from "~/hooks";
import {
  fromEmployeeTypePermissions,
  toCompanyPermissions,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import type { CompanyPermission } from "~/modules/users/types";
import {
  bulkPermissionsAllMatchingValidator,
  bulkPermissionsValidator
} from "~/modules/users/users.models";
import { path } from "~/utils/path";
import {
  AllMatchingUsersNote,
  type BulkUserActionFetcher
} from "../components/AllMatchingUsers";

type BulkEditPermissionsProps = {
  userIds: string[];
  isOpen: boolean;
  /** Set when the action applies to every matching user of the list. */
  allMatching?: AllMatchingSelection | null;
  /** Posts the every-matching-user request. The table owns it, so its result
   *  toast still shows after this drawer closes. */
  allMatchingFetcher?: BulkUserActionFetcher;
  onClose: () => void;
};

const BulkEditPermissions = ({
  userIds,
  isOpen,
  allMatching,
  allMatchingFetcher,
  onClose
}: BulkEditPermissionsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const emptyPermissionsFetcher = useLoaderQuery<{
    permissions: Record<
      string,
      {
        name: string;
        permission: CompanyPermission;
      }
    >;
  }>(path.to.api.emptyPermissions);

  const canEditPermissions = permissions.can("update", "users");

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
          validator={
            allMatching
              ? bulkPermissionsAllMatchingValidator
              : bulkPermissionsValidator
          }
          method="post"
          action={path.to.bulkEditPermissions}
          // Every matching user runs in the background: the route answers
          // data, not a redirect, so it posts through a fetcher.
          fetcher={allMatching ? allMatchingFetcher : undefined}
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

              {allMatching ? (
                <>
                  <AllMatchingUsersNote />
                  <Hidden
                    name="allMatching"
                    value={JSON.stringify(allMatchingRequest(allMatching))}
                  />
                </>
              ) : (
                <Employees
                  name="userIds"
                  selectionsMaxHeight={"calc(100vh - 330px)"}
                  label={t`Users to Update`}
                />
              )}

              {hasModules && (
                <PermissionMatrix
                  matrix={matrix}
                  isDisabled={!canEditPermissions}
                />
              )}
              <Hidden name="data" value={permissionsData} />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={!canEditPermissions}>
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
