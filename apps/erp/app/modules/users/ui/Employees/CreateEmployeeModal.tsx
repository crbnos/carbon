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
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher, useNavigate } from "react-router";
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
  const { t } = useLingui();
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
      label: et.name
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
            locationId: defaults?.locationId ?? undefined
          }}
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create an account</Trans>
            </ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <Input name="email" label={t`Email`} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <Input name="firstName" label={t`First Name`} />
                <Input name="lastName" label={t`Last Name`} />
              </div>
              <Select
                name="employeeType"
                label={t`Employee Type`}
                termId="create-employee-employee-type"
                options={employeeTypeOptions}
                placeholder={t`Select Employee Type`}
              />
              <Location
                name="locationId"
                label={t`Location`}
                termId="create-employee-location"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isLoading={formFetcher.state !== "idle"}>
                <Trans>Invite</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default CreateEmployeeModal;
