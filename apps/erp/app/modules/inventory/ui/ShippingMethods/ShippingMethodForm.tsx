import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  shippingCarrierType,
  shippingMethodValidator
} from "~/modules/inventory";
import { path } from "~/utils/path";

type ShippingMethodFormProps = {
  initialValues: z.infer<typeof shippingMethodValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const ShippingMethodForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: ShippingMethodFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created shipping method`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create shipping method: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "inventory")
    : !permissions.can("create", "inventory");

  const shippingCarrierOptions = shippingCarrierType.map((v) => ({
    label: v,
    value: v
  }));

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={shippingMethodValidator}
            method="post"
            action={
              isEditing
                ? path.to.shippingMethod(initialValues.id!)
                : path.to.newShippingMethod
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Shipping Method` : t`New Shipping Method`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Select
                  name="carrier"
                  label={t`Carrier`}
                  options={shippingCarrierOptions}
                />
                <Account
                  classes={["Expense"]}
                  name="carrierAccountId"
                  label={t`Carrier Account`}
                  termId="shipping-method-carrier-account"
                />
                <Input
                  name="trackingUrl"
                  label={t`Tracking URL`}
                  termId="shipping-method-tracking-url"
                  prefix="https://"
                />
                <CustomFormFields table="shippingMethod" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ShippingMethodForm;
