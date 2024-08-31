import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack,
  toast,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import {
  Account,
  CustomFormFields,
  Hidden,
  Input,
  Select,
  Submit,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  shippingCarrierType,
  shippingMethodValidator,
} from "~/modules/inventory";
import { path } from "~/utils/path";

type ShippingMethodFormProps = {
  initialValues: z.infer<typeof shippingMethodValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose?: (data?: { id: string; name: string }) => void;
};

const ShippingMethodForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
}: ShippingMethodFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created shipping method`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create shipping method: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "inventory")
    : !permissions.can("create", "inventory");

  const shippingCarrierOptions = shippingCarrierType.map((v) => ({
    label: v,
    value: v,
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
                {isEditing ? "Edit" : "New"} Shipping Method
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <Select
                  name="carrier"
                  label="Carrier"
                  options={shippingCarrierOptions}
                />
                <Account
                  classes={["Expense"]}
                  name="carrierAccountId"
                  label="Carrier Account"
                />
                <Input
                  name="trackingUrl"
                  label="Tracking URL"
                  prefix="https://"
                />
                <CustomFormFields table="shippingMethod" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ShippingMethodForm;
