import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Status,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { LuCheckCheck, LuSave } from "react-icons/lu";
import { Link } from "react-router";
import type { z } from "zod";
import { EmployeeAvatar } from "~/components";
import type { ClientDocumentLine } from "~/components/DocumentLineEditor";
import { DocumentLineEditor } from "~/components/DocumentLineEditor";
import {
  Currency,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  NumberControlled,
  TextArea
} from "~/components/Form";
import { useCurrencyDecimals, useCurrencyFormatter } from "~/hooks";
import type { DimensionWithValues } from "~/modules/accounting/ui/JournalEntries/types";
import { path } from "~/utils/path";
import type { reimbursementUpdateValidator } from "../../invoicing.models";
import { reimbursementUpdateValidator as validator } from "../../invoicing.models";

type ReimbursementEditFormProps = {
  reimbursementId: string;
  displayId: string;
  employeeId: string;
  initialValues: z.infer<typeof reimbursementUpdateValidator>;
  initialLines: ClientDocumentLine[];
  dimensions: DimensionWithValues[];
};

const ReimbursementEditForm = ({
  reimbursementId,
  displayId,
  employeeId,
  initialValues,
  initialLines,
  dimensions
}: ReimbursementEditFormProps) => {
  const { t } = useLingui();
  const currencyCode = initialValues.currencyCode;
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

  // The header amount is local state so the line editor's balance check
  // follows a live edit rather than the value the page loaded with.
  const [headerAmount, setHeaderAmount] = useState(initialValues.amount);
  const [totals, setTotals] = useState<{ total: number; isBalanced: boolean }>({
    total: initialLines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
    isBalanced: false
  });

  const onTotalChange = useCallback((total: number, isBalanced: boolean) => {
    setTotals({ total, isBalanced });
  }, []);

  return (
    <ValidatedForm
      method="post"
      validator={validator}
      defaultValues={initialValues}
      style={{ width: "100%" }}
    >
      <VStack spacing={4} className="w-full">
        {/* The running total lives in the page header, so the user sees the
            line sum against the document amount as they type. */}
        <HStack className="w-full justify-between">
          <HStack spacing={2}>
            <Heading as="h1" size="h3">
              {displayId}
            </Heading>
            <EmployeeAvatar employeeId={employeeId} />
          </HStack>
          <HStack spacing={2}>
            <span className="text-sm text-muted-foreground tabular-nums">
              {currencyFormatter.format(totals.total)}
            </span>
            {totals.isBalanced ? (
              <Status color="green">{t`Balanced`}</Status>
            ) : (
              <Status color="red">{t`Unbalanced`}</Status>
            )}
          </HStack>
        </HStack>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Details</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Hidden name="id" />
            <Hidden name="exchangeRate" />
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 w-full">
              <DatePicker
                name="reimbursementDate"
                label={t`Reimbursement Date`}
              />
              <Currency name="currencyCode" label={t`Currency`} />
              <NumberControlled
                name="amount"
                label={t`Amount`}
                value={headerAmount}
                onChange={(value) => setHeaderAmount(isNaN(value) ? 0 : value)}
                formatOptions={INPUT_FORMAT.money(
                  currencyCode,
                  currencyDecimals
                )}
                step={INPUT_STEP.money(currencyDecimals)}
                minValue={0}
              />
              <Input name="reference" label={t`Reference`} />
              <div className="md:col-span-2">
                <TextArea name="notes" label={t`Notes`} />
              </div>
              <CustomFormFields table="reimbursement" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Line items</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentLineEditor
              initialLines={initialLines}
              currencyCode={currencyCode}
              availableDimensions={dimensions}
              headerAmount={headerAmount}
              onTotalChange={onTotalChange}
            />
          </CardContent>
        </Card>

        <HStack className="w-full justify-end">
          <Button variant="secondary" asChild>
            <Link to={path.to.reimbursement(reimbursementId)}>
              <Trans>Cancel</Trans>
            </Link>
          </Button>
          <Button
            type="submit"
            name="intent"
            value="save"
            leftIcon={<LuSave />}
            variant="secondary"
          >
            <Trans>Save</Trans>
          </Button>
          <Button
            type="submit"
            name="intent"
            value="save-and-post"
            leftIcon={<LuCheckCheck />}
            variant="primary"
            isDisabled={!totals.isBalanced}
          >
            <Trans>Save and post</Trans>
          </Button>
        </HStack>
      </VStack>
    </ValidatedForm>
  );
};

export default ReimbursementEditForm;
