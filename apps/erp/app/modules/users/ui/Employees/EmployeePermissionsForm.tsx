import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Hidden, Select, Submit } from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import {
  fromCompanyPermissions,
  toCompanyPermissions,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import type { CompanyPermission } from "~/modules/users";
import { employeeValidator } from "~/modules/users";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type EmployeePermissionsFormProps = {
  name: string;
  employeeTypes: ListItem[];
  employeeTypePermissions: Record<string, Record<string, CompanyPermission>>;
  initialValues: z.infer<typeof employeeValidator> & {
    permissions: Record<string, CompanyPermission>;
  };
};

const EmployeePermissionsForm = ({
  name,
  employeeTypes,
  employeeTypePermissions,
  initialValues
}: EmployeePermissionsFormProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const employeeTypeOptions =
    employeeTypes?.map((et) => ({
      value: et.id,
      label: et.name
    })) ?? [];

  const { state: initialState, modules } = useMemo(
    () => fromCompanyPermissions(initialValues.permissions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialValues.permissions]
  );

  const matrix = usePermissionMatrix({
    modules,
    initialState
  });

  const [pendingEmployeeTypeId, setPendingEmployeeTypeId] = useState<
    string | null
  >(null);

  const handleEmployeeTypeChange = (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => {
    if (!newValue) return;
    const newId = newValue.value;
    if (newId && newId !== initialValues.employeeType) {
      setPendingEmployeeTypeId(newId);
    }
  };

  const handleConfirmOverwrite = () => {
    if (pendingEmployeeTypeId) {
      const perms = employeeTypePermissions[pendingEmployeeTypeId] ?? {};
      const nextState: Record<string, boolean> = {};
      for (const [mod] of matrix.modules) {
        const p = perms[mod];
        nextState[`${mod}_view`] = p?.view ?? false;
        nextState[`${mod}_create`] = p?.create ?? false;
        nextState[`${mod}_update`] = p?.update ?? false;
        nextState[`${mod}_delete`] = p?.delete ?? false;
      }
      matrix.setPermissions(nextState);
    }
    setPendingEmployeeTypeId(null);
  };

  const permissionsData = JSON.stringify(
    toCompanyPermissions(matrix.permissions)
  );

  return (
    <>
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
            className="flex flex-col h-full"
          >
            <ModalHeader>
              <ModalTitle>{name}</ModalTitle>
            </ModalHeader>
            <ModalBody className="max-h-[70dvh] overflow-y-auto">
              <VStack spacing={4}>
                <Select
                  name="employeeType"
                  label={t`Employee Type`}
                  termId="employee-permissions-employee-type-override"
                  options={employeeTypeOptions}
                  placeholder={t`Select Employee Type`}
                  onChange={handleEmployeeTypeChange}
                />
                <PermissionMatrix matrix={matrix} />
                <Hidden name="id" />
                <Hidden name="data" value={permissionsData} />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Submit>
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

      <Modal
        open={pendingEmployeeTypeId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingEmployeeTypeId(null);
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Update Permissions</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Do you want to overwrite the user's current permissions with the
                default permissions for this employee type?
              </Trans>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => setPendingEmployeeTypeId(null)}
            >
              <Trans>Keep Current</Trans>
            </Button>
            <Button variant="primary" onClick={handleConfirmOverwrite}>
              <Trans>Overwrite Permissions</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default EmployeePermissionsForm;
