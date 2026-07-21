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
  VStack
} from "@carbon/react";
import { useState } from "react";
import type { z } from "zod";
import {
  Hidden,
  Input,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { budgetValidator } from "../../accounting.models";
import type { Budget } from "../../types";

type BudgetFormProps = {
  initialValues: z.infer<typeof budgetValidator>;
  open?: boolean;
  onClose: () => void;
};

const BudgetForm = ({
  initialValues,
  open = true,
  onClose
}: BudgetFormProps) => {
  const permissions = usePermissions();
  const routeData = useRouteData<{ budgets: Budget[] }>(path.to.budgets);
  const budgets = routeData?.budgets ?? [];

  const isEditing = initialValues.id !== undefined;
  const [source, setSource] = useState<string>(initialValues.source ?? "none");
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={budgetValidator}
            method="post"
            action={
              isEditing
                ? path.to.editBudget(initialValues.id!)
                : path.to.newBudget
            }
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Budget
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label="Name" />
                <NumberField name="fiscalYear" label="Fiscal Year" />
                <TextArea name="description" label="Description" />
                {!isEditing && (
                  <>
                    <Select
                      name="source"
                      label="Start From"
                      options={[
                        { value: "none", label: "Empty budget" },
                        { value: "budget", label: "Copy another budget" },
                        { value: "actuals", label: "Prior-year actuals" }
                      ]}
                      onChange={(option) => setSource(option?.value ?? "none")}
                    />
                    {source === "budget" && (
                      <Select
                        name="sourceBudgetId"
                        label="Source Budget"
                        options={budgets.map((b) => ({
                          value: b.id,
                          label: `${b.name} (FY${b.fiscalYear})`
                        }))}
                      />
                    )}
                    {source === "actuals" && (
                      <NumberField
                        name="sourceFiscalYear"
                        label="Actuals From Fiscal Year"
                      />
                    )}
                    {source !== "none" && (
                      <>
                        <NumberField
                          name="adjustmentFactor"
                          label="Adjustment Factor (e.g. 1.05 = +5%)"
                        />
                        <Select
                          name="spread"
                          label="Spread"
                          options={[
                            { value: "source", label: "Match source periods" },
                            { value: "even", label: "Spread evenly" }
                          ]}
                        />
                      </>
                    )}
                  </>
                )}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={() => onClose?.()}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default BudgetForm;
