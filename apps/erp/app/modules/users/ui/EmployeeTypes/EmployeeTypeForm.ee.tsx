// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useCloseRoute
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuShieldCheck } from "react-icons/lu";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { employeeTypeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";
import AccessGrid, { type AccessGrant } from "../components/AccessGrid.ee";
import AccessHolders from "./AccessHolders.ee";

type EmployeeTypeFormProps = {
  initialValues: Omit<z.infer<typeof employeeTypeValidator>, "data"> & {
    grants: AccessGrant[];
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
  const closeRoute = useCloseRoute();
  const onClose = () => closeRoute();

  // The person's edits; the route remounts the form for another type.
  const [grants, setGrants] = useState(initialValues.grants);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !userPermissions.can("update", "users")
    : !userPermissions.can("create", "users");

  return (
    <Modal
      open
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
          <Hidden name="data" value={JSON.stringify(grants)} />
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
                  <Trans>Access</Trans>
                </h3>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Everyone with this type gets these levels, and a change
                    reaches them on their next request.
                  </Trans>
                </p>
              </div>
              {isAdmin ? (
                <Alert>
                  <LuShieldCheck />
                  <AlertTitle>
                    <Trans>Admin has full access</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Every level on every module, including modules added
                      later. There is nothing to set.
                    </Trans>
                  </AlertDescription>
                </Alert>
              ) : (
                <AccessGrid
                  value={grants}
                  onChange={setGrants}
                  termId="employee-type-default-permissions"
                  notes={Object.fromEntries(
                    convertedGrowth.map((row) => [
                      row.id,
                      t`Gained ${row.gained.join(", ")} when permissions became levels`
                    ])
                  )}
                  isDisabled={isDisabled}
                />
              )}
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
