import { ValidatedForm, useControlField, useField } from "@carbon/form";
import {
  Combobox,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack,
} from "@carbon/react";
import { useFetcher, useNavigate } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Submit, Supplier } from "~/components/Form";
import { useUrlParams } from "~/hooks";
import type {
  SupplierContact as SupplierContactType,
  getSupplierContacts,
} from "~/modules/purchasing";
import { createSupplierAccountValidator } from "~/modules/users";
import type { Result } from "~/types";
import { path } from "~/utils/path";

const CreateSupplierModal = () => {
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
            supplier: params.get("supplier") ?? "",
          }}
          // @ts-ignore
          fetcher={formFetcher}
          className="flex flex-col h-full"
        >
          <ModalHeader>
            <ModalTitle>Create an account</ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              <Supplier
                name="supplier"
                label="Supplier"
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
                    <FormLabel>Email</FormLabel>
                    <Input isReadOnly value={contact?.email ?? ""} />
                  </FormControl>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <FormControl>
                      <FormLabel>First Name</FormLabel>
                      <Input isReadOnly value={contact?.firstName ?? ""} />
                    </FormControl>
                    <FormControl>
                      <FormLabel>Last Name</FormLabel>
                      <Input isReadOnly value={contact?.lastName ?? ""} />
                    </FormControl>
                  </div>
                </>
              )}
            </VStack>
            <ModalFooter>
              <HStack>
                <Submit isLoading={formFetcher.state !== "idle"}>
                  Create User
                </Submit>
              </HStack>
            </ModalFooter>
          </ModalBody>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

const SupplierContact = ({
  name,
  supplier,
  onChange,
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
  const { error, defaultValue } = useField(name);
  const [value, setValue] = useControlField<string | null>(name);

  const supplierContactFetcher =
    useFetcher<Awaited<ReturnType<typeof getSupplierContacts>>>();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier]);

  const options = useMemo(
    () =>
      supplierContactFetcher.data?.data
        ? supplierContactFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.contact?.fullName ?? c.contact?.email ?? "Unknown",
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

      onChange({ id: newValue, contact: contact?.contact ?? null });
    }
  };

  // so that we can call onChange on load
  useEffect(() => {
    if (value && value === defaultValue) {
      handleChange(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, supplierContactFetcher.data?.data]);

  return (
    <FormControl isInvalid={!!error}>
      <FormLabel htmlFor={name}>Supplier Contact</FormLabel>
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
