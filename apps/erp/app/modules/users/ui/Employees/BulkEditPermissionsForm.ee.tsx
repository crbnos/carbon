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
import { usePermissions } from "~/hooks";
import { bulkPermissionsValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";
import AccessGrid, { type AccessGrant } from "../components/AccessGrid.ee";

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
  const permissions = usePermissions();
  // The overrides to apply. A module left on "No change" is not touched.
  const [grants, setGrants] = useState<AccessGrant[]>([]);

  const canEditPermissions = permissions.can("update", "users");

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

              <AccessGrid
                value={grants}
                onChange={setGrants}
                inheritLabel={t`No change`}
                showInherited={false}
                label={t`Access`}
                isDisabled={!canEditPermissions}
              />
              <Hidden name="data" value={JSON.stringify(grants)} />
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
