// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { type Level, moduleOf, PAGES } from "@carbon/database/access";
import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
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
  employee: { name: string; email: string | null; avatarUrl: string | null };
  employeeTypes: EmployeeType[];
  /** Every role's grants, so a new type shows its levels at once. */
  roleGrants: RoleGrant[];
  /** Access as saved, per page: what grew in the conversion. */
  effectiveAccess: { page: string; gained: string[] }[];
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
  employee,
  employeeTypes,
  roleGrants,
  effectiveAccess,
  initialValues
}: EmployeePermissionsFormProps) => {
  const { t } = useLingui();
  const closeRoute = useCloseRoute();
  const permissions = usePermissions();
  const onClose = () => closeRoute();

  const canEdit = permissions.can("update", "users");

  // The person's edits; the route remounts the form for another person.
  const [grants, setGrants] = useState(initialValues.grants);
  // A new type changes what is inherited; the overrides stay.
  const [employeeTypeId, setEmployeeTypeId] = useState(
    initialValues.employeeType
  );
  const type = employeeTypes.find((et) => et.id === employeeTypeId);
  const isAdmin = type?.systemType === "Admin";
  const inherited = roleLevels(type, roleGrants);

  const isDirty =
    employeeTypeId !== initialValues.employeeType ||
    JSON.stringify(grants) !== JSON.stringify(initialValues.grants);

  const notes = Object.fromEntries(
    effectiveAccess
      .filter((row) => row.gained.length > 0)
      .map((row) => [
        row.page,
        t`Gained ${row.gained.join(", ")} when permissions became levels`
      ])
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
          <Hidden name="id" />
          <Hidden name="data" value={JSON.stringify(grants)} />
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
              {isAdmin ? (
                <Alert>
                  <LuShieldCheck />
                  <AlertTitle>
                    <Trans>Full access through the Admin type</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Admin has every level on every module, including modules
                      added later. Overrides don't apply while this person is an
                      Admin.
                    </Trans>
                  </AlertDescription>
                </Alert>
              ) : (
                <AccessGrid
                  value={grants}
                  onChange={setGrants}
                  inherited={inherited}
                  inheritsFrom={type?.name ?? t`Role`}
                  inheritLabel={t`Role default`}
                  notes={notes}
                  isDisabled={!canEdit}
                />
              )}
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
