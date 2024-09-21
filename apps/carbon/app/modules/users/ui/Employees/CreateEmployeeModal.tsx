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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack,
  useMount,
} from "@carbon/react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useState } from "react";
import {
  Combobox,
  Hidden,
  Input,
  InputControlled,
  Select,
  Submit,
} from "~/components/Form";
import type { getEmployeeTypes, getInvitable } from "~/modules/users";
import { createEmployeeValidator } from "~/modules/users";
import type { Result } from "~/types";
import { path } from "~/utils/path";

type CreateEmployeeModalProps = {
  invitable: NonNullable<Awaited<ReturnType<typeof getInvitable>>["data"]>;
};

const CreateEmployeeModal = ({ invitable }: CreateEmployeeModalProps) => {
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const employeeTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getEmployeeTypes>>>();

  const [employee, setEmployee] = useState<{
    email: string;
    firstName: string;
    lastName: string;
  } | null>(null);

  useMount(() => {
    employeeTypeFetcher.load(path.to.api.employeeTypes);
  });

  const employeeTypeOptions =
    employeeTypeFetcher.data?.data?.map((et) => ({
      value: et.id,
      label: et.name,
    })) ?? [];

  const hasInvitables = invitable.length > 0;

  if (!hasInvitables) {
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
            // @ts-ignore
            fetcher={formFetcher}
            className="flex flex-col h-full"
          >
            <ModalHeader>
              <ModalTitle>Create an account</ModalTitle>
            </ModalHeader>

            <ModalBody>
              <Hidden name="intent" value="new" />
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
              </VStack>
              <ModalFooter>
                <HStack>
                  <Submit>Create User</Submit>
                </HStack>
              </ModalFooter>
            </ModalBody>
          </ValidatedForm>
        </ModalContent>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalBody>
          <Tabs defaultValue="new" className="w-full my-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">New</TabsTrigger>
              <TabsTrigger value="existing">Existing</TabsTrigger>
            </TabsList>
            <TabsContent value="new">
              <ValidatedForm
                method="post"
                action={path.to.newEmployee}
                validator={createEmployeeValidator}
                // @ts-ignore
                fetcher={formFetcher}
                className="flex flex-col h-full py-4"
              >
                <Hidden name="intent" value="new" />
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
                  <Submit>Create User</Submit>
                </VStack>
              </ValidatedForm>
            </TabsContent>
            <TabsContent value="existing">
              <ValidatedForm
                method="post"
                action={path.to.newEmployee}
                validator={createEmployeeValidator}
                // @ts-ignore
                fetcher={formFetcher}
                className="flex flex-col h-full py-4"
              >
                <Hidden name="intent" value="invite" />
                <Hidden name="email" value={employee?.email ?? ""} />
                <VStack spacing={4}>
                  <Combobox
                    name="_id"
                    options={invitable.map((i) => ({
                      value: i.id!,
                      label: i.name!,
                    }))}
                    label="Employee"
                    onChange={(newValue) => {
                      const selectedEmployee = invitable.find(
                        (i) => i.id === newValue?.value
                      );
                      if (
                        selectedEmployee?.email &&
                        selectedEmployee?.firstName &&
                        selectedEmployee?.lastName
                      ) {
                        // @ts-ignore
                        setEmployee(selectedEmployee);
                      }
                    }}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <InputControlled
                      name="firstName"
                      label="First Name"
                      value={employee?.firstName ?? ""}
                      isReadOnly
                    />
                    <InputControlled
                      name="lastName"
                      label="Last Name"
                      value={employee?.lastName ?? ""}
                      isReadOnly
                    />
                  </div>
                  <Select
                    name="employeeType"
                    label="Employee Type"
                    options={employeeTypeOptions}
                    placeholder="Select Employee Type"
                  />
                  <Submit>Invite User</Submit>
                </VStack>
              </ValidatedForm>
            </TabsContent>
          </Tabs>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default CreateEmployeeModal;
