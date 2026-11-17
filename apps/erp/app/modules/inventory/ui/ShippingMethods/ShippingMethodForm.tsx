// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
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
import { formatPercent } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { z } from "zod";
import {
  Account,
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  shippingCarrierType,
  shippingMethodValidator
} from "~/modules/inventory/inventory.models";
import type { TransitStats } from "~/modules/inventory/inventory.utils";
import { path } from "~/utils/path";

type ShippingMethodFormProps = {
  initialValues: z.infer<typeof shippingMethodValidator>;
  /** the measured transit time; only an existing shipping method has one */
  transitStats?: TransitStats | null;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const ShippingMethodForm = ({
  initialValues,
  transitStats,
  open = true,
  type = "drawer",
  onClose
}: ShippingMethodFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  // A modal closes on the new record; an error is toasted and the form stays.
  const fetcher = useAction({
    onSuccess: () => {
      if (type !== "modal") return;
      onClose?.();
      toast.success(t`Created shipping method`);
    }
  });

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
                <Number
                  name="transitDays"
                  label={t`Transit Days`}
                  termId="shipping-method-transit-days"
                  minValue={0}
                />
                {isEditing && transitStats && (
                  <TransitStatsLine
                    shippingMethodId={initialValues.id!}
                    stats={transitStats}
                    canUpdate={permissions.can("update", "inventory")}
                  />
                )}
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

/**
 * The measured transit time of the last 90 days, with a button that adopts
 * the average (rounded up) as the transit days.
 */
function TransitStatsLine({
  shippingMethodId,
  stats,
  canUpdate
}: {
  shippingMethodId: string;
  stats: TransitStats;
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const fetcher = useAction({
    onSuccess: () => toast.success(t`Updated transit days`)
  });

  if (stats.averageDays === null || stats.suggestedDays === null) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>Not enough deliveries yet to measure the transit time.</Trans>
      </p>
    );
  }

  const average = stats.averageDays.toLocaleString(locale);
  const count = stats.count;
  const days = stats.suggestedDays;
  const rate = (value: number | null) =>
    value === null ? "—" : formatPercent(value, locale);
  const byEstimate = rate(stats.byEstimateRate);
  const byPromise = rate(stats.byPromiseRate);

  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground">
      <p>
        <Trans>
          Last 90 days: {count} shipments, average {average} business days.
          {byEstimate} by the estimate, {byPromise} by the promised date.
        </Trans>
      </p>
      {canUpdate && (
        // This sits inside the shipping method form, so it submits through
        // the fetcher instead of a nested <form>.
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          isLoading={fetcher.state !== "idle"}
          isDisabled={fetcher.state !== "idle"}
          onClick={() =>
            fetcher.submit(null, {
              method: "post",
              action: path.to.shippingMethodTransitSuggestion(shippingMethodId)
            })
          }
        >
          <Trans>Use {days} days</Trans>
        </Button>
      )}
    </div>
  );
}

export default ShippingMethodForm;
