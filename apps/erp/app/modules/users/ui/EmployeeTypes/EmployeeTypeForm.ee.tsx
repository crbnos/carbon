// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { StoredGrant } from "@carbon/database/access-write";
import { subjectGates } from "@carbon/ee/permission-grants";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useRouteDialog
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { employeeTypeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";
import AccessGrid from "../components/AccessGrid.ee";
import AccessHolders from "./AccessHolders.ee";

type EmployeeTypeFormProps = {
  initialValues: Omit<z.infer<typeof employeeTypeValidator>, "grants"> & {
    grants: StoredGrant[];
  };
  /** The Admin type has Full on every module, whatever its grants say. */
  isAdmin?: boolean;
  /** Per module or page id, what the role gained when permissions became levels. */
  convertedGrowth?: { id: string; gained: string[] }[];
};

const EmployeeTypeForm = ({
  initialValues,
  isAdmin = false,
  convertedGrowth = []
}: EmployeeTypeFormProps) => {
  const { t } = useLingui();
  const userPermissions = usePermissions();
  const dialog = useRouteDialog();
  const onClose = dialog.close;

  // The grants being edited; the route remounts the form for another type.
  const [grants, setGrants] = useState(initialValues.grants);

  const isEditing = initialValues.id !== undefined;
  // Creating a type writes its grants too, so it asks Edit like an edit.
  const isDisabled = !userPermissions.has(subjectGates("Edit").role);

  return (
    <Modal
      open={dialog.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          validator={employeeTypeValidator}
          method="post"
          action={
            isEditing
              ? path.to.employeeType(initialValues.id!)
              : path.to.newEmployeeType
          }
          defaultValues={initialValues}
        >
          <Hidden name="id" />
          <Hidden name="grants" value={JSON.stringify(grants)} />
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Edit Employee Type</Trans>
              ) : (
                <Trans>New Employee Type</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-8">
            <Input
              name="name"
              label={t`Employee Type`}
              placeholder={t`e.g. Warehouse Supervisor`}
            />

            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-medium">
                  <Trans>Permissions</Trans>
                </h3>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Set module-level access, then expand a module to fine-tune
                    each of its pages. A change reaches everyone with this type
                    on their next request.
                  </Trans>
                </p>
              </div>
              <AccessGrid
                value={grants}
                onChange={setGrants}
                termId="employee-type-default-permissions"
                admin={isAdmin}
                gained={Object.fromEntries(
                  convertedGrowth.map((row) => [row.id, row.gained])
                )}
                isDisabled={isDisabled}
              />
            </section>

            {isEditing ? <AccessHolders /> : null}
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default EmployeeTypeForm;
