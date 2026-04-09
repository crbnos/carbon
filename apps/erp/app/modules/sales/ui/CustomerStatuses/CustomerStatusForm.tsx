import { ValidatedForm } from "@carbon/form";
import {
  Button,
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
import { useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerStatusValidator } from "../../sales.models";

type CustomerStatusFormProps = {
  initialValues: z.infer<typeof customerStatusValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerStatusForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: CustomerStatusFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created customer status`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create customer status: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

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
            validator={customerStatusValidator}
            method="post"
            action={
              isEditing
                ? path.to.customerStatus(initialValues.id!)
                : path.to.newCustomerStatus
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit` : t`New`} {t`Customer Status`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Customer Status`} />
                <CustomFormFields table="customerStatus" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>{t`Save`}</Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CustomerStatusForm;
