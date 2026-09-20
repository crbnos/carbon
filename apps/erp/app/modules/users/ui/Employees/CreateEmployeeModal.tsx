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
import {
  Boolean,
  Hidden,
  Input,
  Location,
  Select,
  Submit
} from "~/components/Form";
import { useFlags, useUser } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
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
  const { isControlledEnvironment } = useFlags();
  // Enterprise: choosing an employee type on invite is gated to the Business
  // plan. When gated (Community / Starter), every invite defaults to the seeded
  // Admin type — "everyone is an admin".
  const { isGated: permissionsGated } = usePlanGate({ feature: "PERMISSIONS" });
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();
  const employeeTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getEmployeeTypes>>>();

  useMount(() => {
    employeeTypeFetcher.load(path.to.api.employeeTypes);
  });

  const employeeTypes = employeeTypeFetcher.data?.data ?? [];
  const employeeTypeOptions = employeeTypes.map((et) => ({
    value: et.id,
    label: et.name
  }));

  // The seeded Admin type is the only type a gated company has; fall back
  // gracefully if the shape ever changes.
  const adminType =
    employeeTypes.find((et) => et.systemType === "Admin") ??
    employeeTypes.find((et) => et.protected) ??
    employeeTypes[0];

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
              {permissionsGated ? (
                <Hidden name="employeeType" value={adminType?.id ?? ""} />
              ) : (
                <Select
                  name="employeeType"
                  label={t`Employee Type`}
                  termId="create-employee-employee-type"
                  options={employeeTypeOptions}
                  placeholder={t`Select Employee Type`}
                />
              )}
              <Location
                name="locationId"
                label={t`Location`}
                termId="create-employee-location"
              />
              {isControlledEnvironment && (
                <Boolean
                  name="usPersonAttestation"
                  label={t`U.S. Person Attestation`}
                  description={t`I have a reasonable basis to believe this individual is a U.S. person as defined in 22 CFR 120.62`}
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit
                isLoading={formFetcher.state !== "idle"}
                // When gated, employeeType is a hidden field populated from the
                // async-loaded Admin type. Block submit until it resolves, else
                // an empty employeeType fails validation before the route's
                // server-side Admin fallback can apply.
                isDisabled={permissionsGated && !adminType}
              >
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
