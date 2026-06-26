import { useControlField, useField, ValidatedForm } from "@carbon/form";
import {
  Combobox,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Input,
  LabelWithHelp,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { Submit, Supplier } from "~/components/Form";
import { useUrlParams } from "~/hooks";
import type {
  getSupplierContacts,
  SupplierContact as SupplierContactType
} from "~/modules/purchasing";
import { createSupplierAccountValidator } from "~/modules/users";
import type { Result } from "~/types";
import { path } from "~/utils/path";

const CreateSupplierModal = () => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useUrlParams();

  const formFetcher = useFetcher<Result>();
  const [supplier, setSupplier] = useState<string | undefined>(
    (params.get("supplier") as string) ?? undefined
  );
  const [contact, setContact] = useState<SupplierContactType["contact"] | null>(
    null
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.supplierAccounts);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          method="post"
          action={`${path.to.newSupplierAccount}${
            params.get("supplier") ? `?supplier=${params.get("supplier")}` : ""
          }`}
          validator={createSupplierAccountValidator}
          defaultValues={{
            id: params.get("id") ?? "",
            supplier: params.get("supplier") ?? ""
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
              <Supplier
                name="supplier"
                label={t`Supplier`}
                termId="create-supplier-account-supplier"
                onChange={(newValue) =>
                  setSupplier(newValue?.value as string | undefined)
                }
              />
              <SupplierContact
                name="id"
                supplier={supplier}
                onChange={(contact) => setContact(contact?.contact ?? null)}
              />
              {contact && (
                <>
                  <FormControl>
                    <FormLabel>
                      <Trans>Email</Trans>
                    </FormLabel>
                    <Input isReadOnly value={contact?.email ?? ""} />
                  </FormControl>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <FormControl>
                      <FormLabel>
                        <Trans>First Name</Trans>
                      </FormLabel>
                      <Input isReadOnly value={contact?.firstName ?? ""} />
                    </FormControl>
                    <FormControl>
                      <FormLabel>
                        <Trans>Last Name</Trans>
                      </FormLabel>
                      <Input isReadOnly value={contact?.lastName ?? ""} />
                    </FormControl>
                  </div>
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit isLoading={formFetcher.state !== "idle"}>
                <Trans>Create User</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

const SupplierContact = ({
  name,
  supplier,
  onChange
}: {
  name: string;
  supplier?: string;
  onChange?: (
    newValue: {
      id: string;
      contact: SupplierContactType["contact"];
    } | null
  ) => void;
}) => {
  const initialLoad = useRef(true);
  const {
    error,
    defaultValue,
    isOptional: isSupplierContactOptional
  } = useField(name);
  const [value, setValue] = useControlField<string | null>(name);

  const supplierContactFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierContacts>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (supplier) {
      supplierContactFetcher.load(path.to.api.supplierContacts(supplier));
    }

    if (initialLoad.current) {
      initialLoad.current = false;
    } else {
      setValue(null);
      if (onChange) {
        onChange(null);
      }
    }
  }, [supplier]);

  const options = useMemo(
    () =>
      supplierContactFetcher.data?.data
        ? supplierContactFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.contact?.fullName ?? c.contact?.email ?? "Unknown"
          }))
        : [],
    [supplierContactFetcher.data]
  );

  const handleChange = (newValue: string) => {
    setValue(newValue ?? "");
    if (onChange && typeof onChange === "function") {
      if (!newValue) onChange(null);
      const contact = supplierContactFetcher.data?.data?.find(
        (c) => c.id === newValue
      );

      // @ts-expect-error TS2322 - TODO: fix type
      onChange({ id: newValue, contact: contact?.contact ?? null });
    }
  };

  // so that we can call onChange on load
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (value && value === defaultValue) {
      handleChange(value);
    }
  }, [value, supplierContactFetcher.data?.data]);

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel htmlFor={name} isOptional={isSupplierContactOptional}>
        <LabelWithHelp termId="create-supplier-account-contact">
          <Trans>Supplier Contact</Trans>
        </LabelWithHelp>
      </FormLabel>
      <input type="hidden" name={name} id={name} value={value ?? ""} />
      <Combobox
        id={name}
        value={value ?? undefined}
        options={options}
        onChange={handleChange}
        className="w-full"
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default CreateSupplierModal;
