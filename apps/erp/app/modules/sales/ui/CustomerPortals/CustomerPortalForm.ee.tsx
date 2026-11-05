// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Submit
} from "~/components/Form";
import { useCompanyToday, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerPortalValidator } from "../../sales.models";
import { customerPortalEarliestExpiry } from "../../sales.utils";

type CustomerPortalFormProps = {
  initialValues: z.infer<typeof customerPortalValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerPortalForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: CustomerPortalFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created customer portal`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create customer portal: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const earliestExpiry = parseDate(
    customerPortalEarliestExpiry(useCompanyToday(), initialValues.expiresOn)
  );

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
            validator={customerPortalValidator}
            method="post"
            action={
              isEditing
                ? path.to.customerPortal(initialValues.id!)
                : path.to.newCustomerPortal
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? <Trans>Edit</Trans> : <Trans>New</Trans>}{" "}
                <Trans>Customer Portal</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Customer
                  name="customerId"
                  label={t`Customer`}
                  termId="customer-portal-customer"
                />
                <DatePicker
                  name="expiresOn"
                  minValue={earliestExpiry}
                  label={t`Expires On`}
                  helperText={t`The link stops working on this day. Leave blank to keep it open.`}
                />
                <CustomFormFields table="externalLink" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CustomerPortalForm;
