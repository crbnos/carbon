// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
  useCloseRoute,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
  /** The role's converted grants that hold more than their old checkboxes. */
  convertedGrowth?: { label: string; level: string; gained: string[] }[];
};

const EmployeeTypeForm = ({
  initialValues,
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
          <ModalHeader>
            <ModalTitle>
              {isEditing ? (
                <Trans>Edit Employee Type</Trans>
              ) : (
                <Trans>New Employee Type</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label={t`Employee Type`} />
              <Hidden name="data" value={JSON.stringify(grants)} />
            </VStack>
            <div className="mt-4">
              <AccessGrid
                value={grants}
                onChange={setGrants}
                label={t`Access`}
                termId="employee-type-default-permissions"
                isDisabled={isDisabled}
              />
              {convertedGrowth.length > 0 ? (
                <div className="mt-4 rounded-md border border-yellow-500/40 p-3 text-sm">
                  <p className="font-medium mb-1">
                    <Trans>Converted access that grew</Trans>
                  </p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {convertedGrowth.map((row) => (
                      <li key={row.label}>
                        {t`${row.label}: ${row.level}, gained ${row.gained.join(", ")}`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {isEditing ? (
                <div className="mt-4">
                  <AccessHolders />
                </div>
              ) : null}
            </div>
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
