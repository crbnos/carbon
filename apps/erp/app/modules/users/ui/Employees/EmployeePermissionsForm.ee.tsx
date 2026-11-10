// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { StoredGrant } from "@carbon/database/access-write";
import { subjectGates } from "@carbon/ee/permission-grants";
import { ValidatedForm } from "@carbon/form";
import {
  Avatar,
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
import { Hidden, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { employeeValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";
import AccessGrid from "../components/AccessGrid.ee";

/** `admin`: the company's own Admin type (`isAdminType`). */
type EmployeeType = { id: string; name: string; admin: boolean };

type RoleGrant = StoredGrant & { employeeTypeId: string | null };

type EmployeePermissionsFormProps = {
  employee: { name: string; email: string | null; avatarUrl: string | null };
  employeeTypes: EmployeeType[];
  /** Every role's grants, so a new type shows its levels at once. */
  roleGrants: RoleGrant[];
  /** Access as saved, per page: what grew in the conversion. */
  effectiveAccess: { page: string; gained: string[] }[];
  initialValues: Omit<z.infer<typeof employeeValidator>, "grants"> & {
    /** The person's own overrides. */
    grants: StoredGrant[];
  };
};

const EmployeePermissionsForm = ({
  employee,
  employeeTypes,
  roleGrants,
  effectiveAccess,
  initialValues
}: EmployeePermissionsFormProps) => {
  const { t } = useLingui();
  const dialog = useRouteDialog();
  const permissions = usePermissions();
  const onClose = dialog.close;

  const canEdit = permissions.has(subjectGates("Edit").person);

  // The person's edits; the route remounts the form for another person.
  const [grants, setGrants] = useState(initialValues.grants);
  // A new type changes what is inherited; the overrides stay.
  const [employeeTypeId, setEmployeeTypeId] = useState(
    initialValues.employeeType
  );
  const type = employeeTypes.find((et) => et.id === employeeTypeId);
  const isAdmin = type?.admin ?? false;
  const inherited = roleGrants.filter((g) => g.employeeTypeId === type?.id);

  const isDirty =
    employeeTypeId !== initialValues.employeeType ||
    JSON.stringify(grants) !== JSON.stringify(initialValues.grants);

  return (
    <Modal
      open={dialog.open}
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
          <Hidden name="id" />
          <Hidden name="grants" value={JSON.stringify(grants)} />
          <ModalHeader>
            <div className="flex items-center gap-3">
              <Avatar
                size="sm"
                name={employee.name}
                src={employee.avatarUrl ?? undefined}
              />
              <div className="min-w-0">
                <ModalTitle className="truncate">{employee.name}</ModalTitle>
                {employee.email ? (
                  <p className="truncate text-sm text-muted-foreground">
                    {employee.email}
                  </p>
                ) : null}
              </div>
            </div>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-8">
            <Select
              name="employeeType"
              label={t`Employee Type`}
              termId="employee-permissions-employee-type-override"
              helperText={t`The type sets this person's access, and changes to it reach them too.`}
              options={employeeTypes.map((et) => ({
                value: et.id,
                label: et.name
              }))}
              placeholder={t`Select Employee Type`}
              isReadOnly={!canEdit}
              onChange={(option) => {
                if (option) setEmployeeTypeId(option.value);
              }}
            />

            <section className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium">
                    <Trans>Permissions</Trans>
                  </h3>
                  {isAdmin ? null : (
                    <p className="text-xs text-muted-foreground">
                      <Trans>
                        Check a module to override the type on all its pages, or
                        expand it to override one page.
                      </Trans>
                    </p>
                  )}
                </div>
                {grants.length > 0 && !isAdmin && canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setGrants([])}
                  >
                    <Trans>Reset all overrides</Trans>
                  </Button>
                ) : null}
              </div>
              <AccessGrid
                value={grants}
                onChange={setGrants}
                mode={{
                  edits: "overrides",
                  inherited,
                  from: type?.name ?? t`Role`
                }}
                admin={isAdmin}
                gained={Object.fromEntries(
                  effectiveAccess.map((row) => [row.page, row.gained])
                )}
                isDisabled={!canEdit}
              />
            </section>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={!canEdit || !isDirty}>
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
