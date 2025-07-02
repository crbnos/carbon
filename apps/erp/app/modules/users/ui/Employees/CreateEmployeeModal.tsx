import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack,
  useMount,
} from "@carbon/react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { Input, Location, Select, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import type { getEmployeeTypes, getInvitable } from "~/modules/users";
import { createEmployeeValidator } from "~/modules/users";
import type { Result } from "~/types";
import { path } from "~/utils/path";

type CreateEmployeeModalProps = {
  invitable: NonNullable<Awaited<ReturnType<typeof getInvitable>>["data"]>;
};

const CreateEmployeeModal = ({ invitable }: CreateEmployeeModalProps) => {
  const { defaults } = useUser();
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const employeeTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getEmployeeTypes>>>();

  useMount(() => {
    employeeTypeFetcher.load(path.to.api.employeeTypes);
  });

  const employeeTypeOptions =
    employeeTypeFetcher.data?.data?.map((et) => ({
      value: et.id,
      label: et.name,
    })) ?? [];

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.newEmployee}
          validator={createEmployeeValidator}
          defaultValues={{
            locationId: defaults?.locationId ?? undefined,
          }}
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>Create an account</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <Input name="email" label="Email" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <Input name="firstName" label="First Name" />
                <Input name="lastName" label="Last Name" />
              </div>
              <Select
                name="employeeType"
                label="Employee Type"
                options={employeeTypeOptions}
                placeholder="Select Employee Type"
              />
              <Location name="locationId" label="Location" />
            </VStack>
            <ModalFooter>
              <HStack>
                <Submit isLoading={formFetcher.state !== "idle"}>Invite</Submit>
              </HStack>
            </ModalFooter>
          </ModalBody>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default CreateEmployeeModal;
