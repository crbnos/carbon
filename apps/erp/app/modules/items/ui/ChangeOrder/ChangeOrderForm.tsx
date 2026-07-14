import {
  Combobox,
  DatePicker,
  Select,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { ListItem } from "~/types";
import {
  changeOrderPriority,
  changeOrderValidator
} from "../../changeOrder.models";

type ChangeOrderFormValues = z.infer<typeof changeOrderValidator>;

type ChangeOrderFormProps = {
  initialValues: ChangeOrderFormValues;
  types: ListItem[];
  // Phase 4 links a Non-Conformance; a lightweight list is passed so the
  // create form can associate one up-front. Optional — omit for Minimal.
  nonConformances?: ListItem[];
};

const ChangeOrderForm = ({
  initialValues,
  types,
  nonConformances = []
}: ChangeOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={changeOrderValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Change Order</Trans>
            ) : (
              <Trans>New Change Order</Trans>
            )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A change order tracks a controlled engineering or manufacturing
                change through review and implementation.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="changeOrderId" />

          <VStack spacing={4}>
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Input name="name" label={t`Name`} />
              <Combobox
                name="changeOrderTypeId"
                label={t`Category`}
                options={types.map((type) => ({
                  label: type.name,
                  value: type.id
                }))}
              />
            </div>
            <TextArea name="reasonForChange" label={t`Reason for Change`} />
            <TextArea name="description" label={t`Description of Change`} />
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Employee name="assignee" label={t`Owner`} />
              <Select
                name="priority"
                label={t`Priority`}
                options={changeOrderPriority.map((priority) => ({
                  label: priority,
                  value: priority
                }))}
              />
              <DatePicker name="openDate" label={t`Open Date`} />
              <DatePicker name="dueDate" label={t`Due Date`} />
              {nonConformances.length > 0 && (
                <Combobox
                  name="nonConformanceId"
                  label={t`Linked NCR`}
                  options={nonConformances.map((nc) => ({
                    label: nc.name,
                    value: nc.id
                  }))}
                />
              )}
              <CustomFormFields table="changeOrder" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "parts")
                : !permissions.can("create", "parts")
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ChangeOrderForm;
