import { useFieldArray, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { IoMdAdd, IoMdClose } from "react-icons/io";
import { LuCheck, LuCircleAlert } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  Hidden,
  Input,
  Location,
  Select,
  Submit
} from "~/components/Form";
import { useFlags, useUser } from "~/hooks";
import type { getEmployeeTypes } from "~/modules/users";
import {
  type BulkInviteActionData,
  type BulkInviteResult,
  bulkCreateEmployeeValidator,
  type createEmployeeValidator,
  indexBulkInviteResultsByRowId
} from "~/modules/users";
import { path } from "~/utils/path";

export type { BulkInviteActionData, BulkInviteResult };

type EmployeeRow = z.infer<typeof createEmployeeValidator>;

const emptyEmployee = (locationId?: string | null): EmployeeRow => ({
  rowId: nanoid(),
  email: "",
  firstName: "",
  lastName: "",
  employeeType: "",
  locationId: locationId ?? "",
  usPersonAttestation: false
});

function EmployeeRows({
  defaultLocationId,
  resultsByRowId
}: {
  defaultLocationId?: string | null;
  resultsByRowId: Map<string, BulkInviteResult>;
}) {
  const { t } = useLingui();
  const { isControlledEnvironment } = useFlags();
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

  const [items, { push, remove }, error] =
    useFieldArray<EmployeeRow>("employees");

  const onAdd = () => {
    flushSync(() => {
      push(emptyEmployee(defaultLocationId));
    });
  };

  return (
    <VStack spacing={4} className="w-full">
      {items.map((item, index) => {
        const rowId = item.defaultValue.rowId ?? "";
        const result = resultsByRowId.get(rowId);
        return (
          <div
            key={item.key}
            className="w-full rounded-lg border border-border p-4 space-y-3"
          >
            {(result || items.length > 1) && (
              <div className="flex items-center justify-end gap-2">
                <HStack>
                  {result &&
                    (result.success ? (
                      <Badge variant="green" className="gap-1">
                        <LuCheck className="h-3 w-3" />
                        {result.message}
                      </Badge>
                    ) : (
                      <Badge variant="red" className="gap-1">
                        <LuCircleAlert className="h-3 w-3" />
                        {result.message}
                      </Badge>
                    ))}
                  {items.length > 1 && (
                    <IconButton
                      aria-label={t`Remove employee`}
                      icon={<IoMdClose />}
                      variant="ghost"
                      onClick={() => remove(index)}
                    />
                  )}
                </HStack>
              </div>
            )}
            <Hidden name={`employees[${index}].rowId`} value={rowId} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
              <div className="md:col-span-2">
                <Input name={`employees[${index}].email`} label={t`Email`} />
              </div>
              <Input
                name={`employees[${index}].firstName`}
                label={t`First Name`}
              />
              <Input
                name={`employees[${index}].lastName`}
                label={t`Last Name`}
              />
              <Select
                name={`employees[${index}].employeeType`}
                label={t`Employee Type`}
                termId="create-employee-employee-type"
                options={employeeTypeOptions}
                placeholder={t`Select Employee Type`}
              />
              <Location
                name={`employees[${index}].locationId`}
                label={t`Location`}
                termId="create-employee-location"
              />
              {isControlledEnvironment && (
                <div className="md:col-span-2">
                  <Boolean
                    name={`employees[${index}].usPersonAttestation`}
                    label={t`U.S. Person Attestation`}
                    description={t`I have a reasonable basis to believe this individual is a U.S. person as defined in 22 CFR 120.62`}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        leftIcon={<IoMdAdd />}
        onClick={onAdd}
      >
        <Trans>Add Employee</Trans>
      </Button>
    </VStack>
  );
}

const BulkInviteEmployeesModal = () => {
  const { defaults } = useUser();
  const navigate = useNavigate();
  const formFetcher = useFetcher<BulkInviteActionData>();
  const [results, setResults] = useState<BulkInviteResult[]>([]);

  const resultsByRowId = useMemo(
    () => indexBulkInviteResultsByRowId(results),
    [results]
  );

  useEffect(() => {
    if (formFetcher.state === "submitting") {
      setResults([]);
    }
  }, [formFetcher.state]);

  useEffect(() => {
    // Full success redirects with a flash toast. Partial/total failure returns
    // JSON so we can render per-row status in the modal.
    if (formFetcher.state !== "idle" || !formFetcher.data) return;

    const actionData = formFetcher.data;
    if (!Array.isArray(actionData.results)) return;

    setResults(actionData.results);
    toast.error(actionData.message);
  }, [formFetcher.data, formFetcher.state]);

  const defaultLocationId = defaults?.locationId ?? undefined;
  const defaultEmployees = useMemo(
    () => [emptyEmployee(defaultLocationId)],
    [defaultLocationId]
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent size="xlarge">
        <ValidatedForm
          method="post"
          action={path.to.bulkInviteEmployees}
          validator={bulkCreateEmployeeValidator}
          defaultValues={{
            employees: defaultEmployees
          }}
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Invite Employees</Trans>
            </ModalTitle>
          </ModalHeader>

          <ModalBody>
            <EmployeeRows
              defaultLocationId={defaultLocationId}
              resultsByRowId={resultsByRowId}
            />
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="solid" onClick={() => navigate(-1)}>
                <Trans>Cancel</Trans>
              </Button>
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

export default BulkInviteEmployeesModal;
