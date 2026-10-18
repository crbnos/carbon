// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { type Level, moduleOf, PAGES } from "@carbon/database/access";
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
import { Hidden, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { employeeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";
import AccessGrid, { type AccessGrant } from "../components/AccessGrid.ee";

type EmployeeType = { id: string; name: string; systemType: string | null };

type RoleGrant = {
  employeeTypeId: string | null;
  module: string;
  page: string | null;
  level: Level;
};

type EmployeePermissionsFormProps = {
  name: string;
  employeeTypes: EmployeeType[];
  /** Every role's grants, so a new type shows its levels at once. */
  roleGrants: RoleGrant[];
  initialValues: Omit<z.infer<typeof employeeValidator>, "data"> & {
    /** The person's own overrides. */
    grants: AccessGrant[];
  };
};

/** What a person on the type gets with no override, per module or page id. */
function roleLevels(
  type: EmployeeType | undefined,
  roleGrants: RoleGrant[]
): Record<string, Level> {
  if (!type) return {};
  if (type.systemType === "Admin") {
    const ids = PAGES.flatMap((page) => [page.id, moduleOf(page.id)]);
    return Object.fromEntries(ids.map((id) => [id, "Full" as const]));
  }
  const levels: Record<string, Level> = {};
  for (const grant of roleGrants) {
    if (grant.employeeTypeId !== type.id) continue;
    levels[grant.page ?? grant.module.toLowerCase()] = grant.level;
  }
  return levels;
}

const EmployeePermissionsForm = ({
  name,
  employeeTypes,
  roleGrants,
  initialValues
}: EmployeePermissionsFormProps) => {
  const { t } = useLingui();
  const closeRoute = useCloseRoute();
  const permissions = usePermissions();
  const onClose = () => closeRoute();

  const canEditPermissions = permissions.can("update", "users");

  const employeeTypeOptions = employeeTypes.map((et) => ({
    value: et.id,
    label: et.name
  }));

  // The person's edits; the route remounts the form for another person.
  const [grants, setGrants] = useState(initialValues.grants);
  // A new type changes what is inherited; the overrides stay.
  const [employeeTypeId, setEmployeeTypeId] = useState(
    initialValues.employeeType
  );
  const inherited = roleLevels(
    employeeTypes.find((et) => et.id === employeeTypeId),
    roleGrants
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          validator={employeeValidator}
          method="post"
          action={path.to.employeeAccount(initialValues.id)}
          defaultValues={initialValues}
        >
          <ModalHeader>
            <ModalTitle>{name}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Select
                name="employeeType"
                label={t`Employee Type`}
                termId="employee-permissions-employee-type-override"
                options={employeeTypeOptions}
                placeholder={t`Select Employee Type`}
                onChange={(option) => {
                  if (option) setEmployeeTypeId(option.value);
                }}
              />
              <AccessGrid
                value={grants}
                onChange={setGrants}
                inherited={inherited}
                inheritLabel={t`Role default`}
                label={t`Access`}
                isDisabled={!canEditPermissions}
              />
              <Hidden name="id" />
              <Hidden name="data" value={JSON.stringify(grants)} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={!canEditPermissions}>
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

export default EmployeePermissionsForm;
