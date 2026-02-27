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
import { Hidden, Input, Submit } from "~/components/Form";
import PermissionMatrix from "~/components/PermissionMatrix";
import { usePermissions } from "~/hooks";
import {
  fromEmployeeTypePermissions,
  toEmployeeTypePermissions,
  usePermissionMatrix
} from "~/hooks/usePermissionMatrix";
import type { CompanyPermission } from "~/modules/users";
import { employeeTypeValidator } from "~/modules/users";
import { path } from "~/utils/path";

type EmployeeTypeFormProps = {
  initialValues: z.infer<typeof employeeTypeValidator> & {
    permissions: Record<
      string,
      {
        name: string;
        permission: CompanyPermission;
      }
    >;
  };
};

const EmployeeTypeForm = ({ initialValues }: EmployeeTypeFormProps) => {
  const userPermissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const { state: initialState, modules } = useMemo(
    () => fromEmployeeTypePermissions(initialValues.permissions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const matrix = usePermissionMatrix({
    modules,
    initialState
  });

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !userPermissions.can("update", "users")
    : !userPermissions.can("create", "users");

  // Serialize permissions to the format expected by the action
  const permissionsData = JSON.stringify(
    Object.values(toEmployeeTypePermissions(matrix.permissions))
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
          validator={employeeTypeValidator}
          method="post"
          action={
            isEditing
              ? path.to.employeeType(initialValues.id!)
              : path.to.newEmployeeType
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>{isEditing ? "Edit" : "New"} Employee Type</ModalTitle>
          </ModalHeader>
          <ModalBody className="max-h-[70dvh] overflow-y-auto">
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Employee Type" />
              <Hidden name="data" value={permissionsData} />
            </VStack>
            <div className="mt-4">
              <PermissionMatrix matrix={matrix} label="Default Permissions" />
            </div>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
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

export default EmployeeTypeForm;
