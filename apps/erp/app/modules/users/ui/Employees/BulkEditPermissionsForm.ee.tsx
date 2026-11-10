// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Employees, Hidden, Radios, Submit } from "~/components/Form";
import {
  type AllMatchingSelection,
  allMatchingRequest
} from "~/components/Table";
import { usePermissions } from "~/hooks";
import {
  bulkPermissionsAllMatchingValidator,
  bulkPermissionsValidator
} from "~/modules/users/users.models";
import { path } from "~/utils/path";
import AccessGrid, { type AccessGrant } from "../components/AccessGrid.ee";
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
  isOpen,
  onClose,
  ...props
}: BulkEditPermissionsProps) => (
  <Drawer
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
    open={isOpen}
  >
    <DrawerContent>
      <BulkEditPermissionsBody onClose={onClose} {...props} />
    </DrawerContent>
  </Drawer>
);

const BulkEditPermissionsBody = ({
  userIds,
  allMatching,
  allMatchingFetcher,
  onClose
}: Omit<BulkEditPermissionsProps, "isOpen">) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  // The overrides to apply. A module left on "No change" is not touched.
  const [grants, setGrants] = useState<AccessGrant[]>([]);

  const canEditPermissions = permissions.has({ "users.accounts": "Edit" });

  return (
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

          <AccessGrid
            value={grants}
            onChange={setGrants}
            inheritLabel={t`No change`}
            showInherited={false}
            label={t`Access`}
            isDisabled={!canEditPermissions}
          />
          <Hidden name="grants" value={JSON.stringify(grants)} />
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
  );
};

export default BulkEditPermissions;
