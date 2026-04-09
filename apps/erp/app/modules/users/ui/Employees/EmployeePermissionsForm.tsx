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
  VStack
} from "@carbon/react";
import { useMemo } from "react";
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
  initialValues: z.infer<typeof employeeValidator> & {
    permissions: Record<string, CompanyPermission>;
  };
};

const EmployeePermissionsForm = ({
  name,
  employeeTypes,
  initialValues
}: EmployeePermissionsFormProps) => {
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

  // Serialize permissions to the format expected by the action
  const permissionsData = JSON.stringify(
    toCompanyPermissions(matrix.permissions)
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
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>{name}</ModalTitle>
          </ModalHeader>
          <ModalBody className="max-h-[70dvh] overflow-y-auto">
            <VStack spacing={4}>
              <Select
                name="employeeType"
                label="Employee Type"
                options={employeeTypeOptions}
                placeholder="Select Employee Type"
              />
              <PermissionMatrix matrix={matrix} />
              <Hidden name="id" />
              <Hidden name="data" value={permissionsData} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit>Save</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default EmployeePermissionsForm;
