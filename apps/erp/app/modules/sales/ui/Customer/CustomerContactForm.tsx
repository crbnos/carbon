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
import type { z } from "zod";
import {
  CustomerLocation,
  CustomFormFields,
  Hidden,
  Input,
  PhoneInput,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import { path } from "~/utils/path";
import { customerContactValidator } from "../../sales.models";

type CustomerContactFormProps = {
  customerId: string;
  initialValues: z.infer<typeof customerContactValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerContactForm = ({
  customerId,
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: CustomerContactFormProps) => {
  const { t } = useLingui();
  const fetcher = useAsyncFetcher<{ success?: boolean; message: string }>({
    onStateChange(state) {
      if (state === "idle" && fetcher.data && !fetcher.data.success) {
        toast.error(fetcher.data.message);
      }
    }
  });

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={customerContactValidator}
          method="post"
          action={
            isEditing
              ? path.to.customerContact(customerId, initialValues.id!)
              : path.to.newCustomerContact(customerId)
          }
          defaultValues={initialValues}
          // @ts-expect-error TODO: ValidatedForm types doesn't yet support useAsyncFetcher - @sidwebworks
          fetcher={fetcher}
          className="flex flex-col h-full"
          onAfterSubmit={() => {
            if (type === "modal") {
              onClose?.();
            }
          }}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? <Trans>Edit</Trans> : <Trans>New</Trans>}{" "}
              <Trans>Contact</Trans>
            </DrawerTitle>
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
              <CustomerLocation
                name="customerLocationId"
                label={t`Location`}
                customer={customerId}
              />
              <TextArea name="notes" label={t`Notes`} />
              <CustomFormFields table="customerContact" />
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

export default CustomerContactForm;
