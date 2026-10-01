// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  PhoneInput,
  Submit,
  SupplierLocation,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { supplierContactValidator } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierContactFormProps = {
  supplierId: string;
  initialValues: z.infer<typeof supplierContactValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const SupplierContactForm = ({
  supplierId,
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: SupplierContactFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created supplier contact`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create supplier contact: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "purchasing")
    : !permissions.can("create", "purchasing");

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={supplierContactValidator}
          method="post"
          action={
            isEditing
              ? path.to.supplierContact(supplierId, initialValues.id!)
              : path.to.newSupplierContact(supplierId)
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Contact</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="type" value={type} />
            <Hidden name="contactId" />
            <VStack spacing={4}>
              <Input name="email" label={t`Email`} />
              <Input name="firstName" label={t`First Name`} />
              <Input name="lastName" label={t`Last Name`} />
              <Input name="title" label={t`Title`} />
              <PhoneInput name="mobilePhone" label={t`Mobile Phone`} />
              <PhoneInput name="homePhone" label={t`Home Phone`} />
              <PhoneInput name="workPhone" label={t`Work Phone`} />
              <PhoneInput name="fax" label={t`Fax`} />
              <SupplierLocation
                name="supplierLocationId"
                label={t`Location`}
                supplier={supplierId}
              />
              <TextArea name="notes" label={t`Notes`} />
              <CustomFormFields table="supplierContact" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default SupplierContactForm;
