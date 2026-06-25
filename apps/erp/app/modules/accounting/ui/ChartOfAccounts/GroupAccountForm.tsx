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
import { Combobox, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  accountClassTypes,
  accountTypes,
  groupAccountValidator
} from "../../accounting.models";
import type { AccountClass, AccountIncomeBalance } from "../../types";

const classToIncomeBalance: Record<AccountClass, AccountIncomeBalance> = {
  Asset: "Balance Sheet",
  Liability: "Balance Sheet",
  Equity: "Balance Sheet",
  Revenue: "Income Statement",
  Expense: "Income Statement"
};

const incomeBalanceToClasses: Record<AccountIncomeBalance, AccountClass[]> = {
  "Balance Sheet": ["Asset", "Liability", "Equity"],
  "Income Statement": ["Revenue", "Expense"]
};

type GroupAccount = {
  id: string;
  name: string;
  incomeBalance: string;
  class: string | null;
  accountType: string | null;
};

type GroupAccountFormProps = {
  initialValues: z.infer<typeof groupAccountValidator>;
  groupAccounts?: GroupAccount[];
  open?: boolean;
  onClose: () => void;
};

const GroupAccountForm = ({
  initialValues,
  groupAccounts = [],
  open = true,
  onClose
}: GroupAccountFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const { t } = useLingui();

  const parentGroup = groupAccounts.find(
    (a) => a.id === initialValues.parentId
  );

  const [incomeBalance, setIncomeBalance] = useState<AccountIncomeBalance>(
    (parentGroup?.incomeBalance as AccountIncomeBalance) ??
      initialValues.incomeBalance
  );
  const [accountClass, setAccountClass] = useState<AccountClass>(
    (parentGroup?.class as AccountClass) ?? initialValues.class
  );

  const hasParent = !!initialValues.parentId || !!parentGroup;
  const isRootGroup = !hasParent;
  const parentIsSystem = hasParent && !parentGroup?.class;

  useEffect(() => {
    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(initialValues.id ? "Updated group" : "Created group");
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to save group: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, initialValues.id]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const onParentChange = (newValue: { value: string } | null) => {
    if (newValue) {
      const group = groupAccounts.find((a) => a.id === newValue.value);
      if (group) {
        setIncomeBalance(group.incomeBalance as AccountIncomeBalance);
        if (group.class) {
          setAccountClass(group.class as AccountClass);
        }
      }
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
            validator={groupAccountValidator}
            method="post"
            action={
              isEditing
                ? path.to.chartOfAccount(initialValues.id!)
                : path.to.newChartOfAccountGroup
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Group
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="intent" value="group" />
              <Hidden name="incomeBalance" value={incomeBalance} />
              <Hidden name="class" value={accountClass} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Combobox
                  name="parentId"
                  label={t`Parent Group`}
                  options={groupAccounts
                    .filter((a) => a.id !== initialValues.id)
                    .filter((a) =>
                      isEditing && accountClass
                        ? a.class === accountClass
                        : true
                    )
                    .map((a) => ({
                      label: a.name,
                      value: a.id
                    }))}
                  onChange={onParentChange}
                />
                <Combobox
                  name="accountType"
                  label={t`Account Type`}
                  termId="group-account-account-type"
                  options={accountTypes.map((t) => ({
                    label: t,
                    value: t
                  }))}
                />
                {isRootGroup || parentIsSystem ? (
                  <Combobox
                    name="_class"
                    label={t`Class`}
                    termId="group-account-class"
                    options={(parentIsSystem
                      ? (incomeBalanceToClasses[incomeBalance] ??
                        accountClassTypes)
                      : [...accountClassTypes]
                    ).map((c) => ({
                      label: c,
                      value: c
                    }))}
                    value={accountClass}
                    onChange={(newValue) => {
                      if (newValue) {
                        const cls = newValue.value as AccountClass;
                        setAccountClass(cls);
                        setIncomeBalance(classToIncomeBalance[cls]);
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">
                        <LabelWithHelp termId="group-account-income-balance-inherited">
                          <Trans>Income/Balance</Trans>
                        </LabelWithHelp>
                      </label>
                      <p className="text-sm">{incomeBalance}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">
                        <LabelWithHelp termId="group-account-class-inherited">
                          <Trans>Class</Trans>
                        </LabelWithHelp>
                      </label>
                      <p className="text-sm">{accountClass}</p>
                    </div>
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

export default GroupAccountForm;
