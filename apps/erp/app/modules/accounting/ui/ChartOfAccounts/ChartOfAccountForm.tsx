// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  LabelWithHelp,
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
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Combobox, Hidden, Input, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  accountAllowabilities,
  accountValidator,
  elementsOfCost
} from "../../accounting.models";
import type { AccountClass, AccountIncomeBalance } from "../../types";

type GroupAccount = {
  id: string;
  number: string | null;
  name: string;
  incomeBalance: string;
  class: string | null;
  accountType: string | null;
};

type ChartOfAccountFormProps = {
  initialValues: z.infer<typeof accountValidator>;
  groupAccounts?: GroupAccount[];
  open?: boolean;
  onClose: () => void;
};

const ChartOfAccountForm = ({
  initialValues,
  groupAccounts = [],
  open = true,
  onClose
}: ChartOfAccountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const initialParent = groupAccounts.find(
    (a) => a.id === initialValues.parentId
  );

  const [selectedGroup, setSelectedGroup] = useState<GroupAccount | undefined>(
    initialParent
  );

  const incomeBalance =
    (selectedGroup?.incomeBalance as AccountIncomeBalance) ??
    initialValues.incomeBalance;
  const accountClass =
    (selectedGroup?.class as AccountClass) ?? initialValues.class;
  const accountType = selectedGroup?.accountType ?? initialValues.accountType;

  // Only the user's pick is state; until they pick, the saved value shows.
  const [pickedAllowability, setAllowability] = useState<string | null>(null);
  const allowability =
    pickedAllowability ?? initialValues.allowability ?? "Allowable";
  const allowabilityLabels: Record<
    (typeof accountAllowabilities)[number],
    string
  > = {
    Allowable: t`Allowable`,
    "Expressly Unallowable": t`Expressly Unallowable`,
    "Mutually Agreed Unallowable": t`Mutually Agreed Unallowable`,
    "Directly Associated Unallowable": t`Directly Associated Unallowable`
  };
  const elementOfCostLabels: Record<(typeof elementsOfCost)[number], string> = {
    Labor: t`Labor`,
    Material: t`Material`,
    Subcontract: t`Subcontract`,
    "Other Direct": t`Other Direct`,
    Travel: t`Travel`
  };

  useEffect(() => {
    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(initialValues.id ? t`Updated account` : t`Created account`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to save account: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, initialValues.id, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const onParentChange = (newValue: { value: string } | null) => {
    if (newValue) {
      const group = groupAccounts.find((a) => a.id === newValue.value);
      setSelectedGroup(group);
    } else {
      setSelectedGroup(undefined);
    }
  };

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={accountValidator}
            method="post"
            action={
              isEditing
                ? path.to.chartOfAccount(initialValues.id!)
                : path.to.newChartOfAccount
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Account` : t`New Account`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="incomeBalance" value={incomeBalance} />
              <Hidden name="class" value={accountClass} />
              <Hidden name="accountType" value={accountType} />
              <Hidden name="consolidatedRate" value="Average" />

              <VStack spacing={4}>
                <Combobox
                  name="parentId"
                  label={t`Parent Group`}
                  termId="chart-of-account-group"
                  options={groupAccounts
                    .filter((a) => a.class !== null)
                    .map((a) => ({
                      label: a.name,
                      value: a.id
                    }))}
                  onChange={onParentChange}
                />
                <Input name="number" label={t`Account Number`} />
                <Input name="name" label={t`Name`} />
                {selectedGroup && (
                  <>
                    {accountType && (
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">
                          <LabelWithHelp termId="chart-of-account-account-type-inherited">
                            <Trans>Account Type</Trans>
                          </LabelWithHelp>
                        </label>
                        <p className="text-sm">{accountType}</p>
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">
                        <LabelWithHelp termId="chart-of-account-income-balance-inherited">
                          <Trans>Income/Balance</Trans>
                        </LabelWithHelp>
                      </label>
                      <p className="text-sm">{incomeBalance}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">
                        <LabelWithHelp termId="chart-of-account-class-inherited">
                          <Trans>Class</Trans>
                        </LabelWithHelp>
                      </label>
                      <p className="text-sm">{accountClass}</p>
                    </div>
                  </>
                )}
                {/* Government contracting: a group account takes no
                    allowability, so the fields are only for a posting account. */}
                {!initialValues.isGroup && (
                  <>
                    <Select
                      name="allowability"
                      label={t`Allowability`}
                      options={accountAllowabilities.map((value) => ({
                        value,
                        label: allowabilityLabels[value]
                      }))}
                      onChange={(selected) =>
                        setAllowability(selected?.value ?? "Allowable")
                      }
                    />
                    {allowability === "Allowable" ? (
                      <Hidden name="unallowableReason" value="" />
                    ) : (
                      <Input
                        name="unallowableReason"
                        label={t`Unallowable reason`}
                        placeholder={t`31.205-14 Entertainment`}
                      />
                    )}
                    <Select
                      name="elementOfCost"
                      label={t`Element of cost`}
                      options={elementsOfCost.map((value) => ({
                        value,
                        label: elementOfCostLabels[value]
                      }))}
                    />
                  </>
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
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

export default ChartOfAccountForm;
