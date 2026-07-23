import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import {
  fiscalYearAndPeriodFor,
  formatDate,
  MONTH_NUMBER
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import {
  createFiscalYearPeriods,
  generateFiscalYearPeriodsValidator,
  getFiscalYearSettings
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Generate Fiscal Year`,
  to: path.to.accountingPeriods
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const settings = await getFiscalYearSettings(client, companyId);
  const startMonth = settings.data?.startMonth
    ? (MONTH_NUMBER[settings.data.startMonth] ?? 1)
    : 1;
  const defaultFiscalYear = fiscalYearAndPeriodFor(
    new Date(),
    startMonth
  ).fiscalYear;

  return { startMonth, defaultFiscalYear };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(
    generateFiscalYearPeriodsValidator
  ).validate(formData);
  if (validation.error) return validationError(validation.error);

  const result = await createFiscalYearPeriods(client, {
    companyId,
    fiscalYear: validation.data.fiscalYear,
    userId
  });
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to generate periods"))
    );
  }

  // The service is idempotent — it only inserts the periods that didn't exist,
  // so `data.length` is how many were newly created (0 = year already complete).
  const created = result.data?.length ?? 0;
  throw redirect(
    path.to.accountingPeriods,
    await flash(
      request,
      success(
        created === 0
          ? "All periods for that fiscal year already exist"
          : `Generated ${created} accounting ${
              created === 1 ? "period" : "periods"
            }`
      )
    )
  );
}

// Given a fiscal year + the company's fiscal start month, the period range spans
// 12 months starting at that month. FY is named by its ending calendar year, so a
// non-January start begins in the prior calendar year (mirrors the service).
function fiscalYearRange(fiscalYear: number, startMonth: number) {
  const firstYear = startMonth === 1 ? fiscalYear : fiscalYear - 1;
  const start = new Date(Date.UTC(firstYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(firstYear, startMonth - 1 + 12, 0));
  const fmt = (d: Date) =>
    formatDate(d.toISOString().split("T")[0], {
      month: "short",
      year: "numeric"
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function GenerateFiscalYearRoute() {
  const { startMonth, defaultFiscalYear } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [year, setYear] = useState(defaultFiscalYear);

  const isValidYear = Number.isInteger(year) && year >= 2000 && year <= 2200;
  const preview = isValidYear ? fiscalYearRange(year, startMonth) : null;
  const isBusy = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingPeriods);
      }}
    >
      <ModalContent size="small">
        <fetcher.Form method="post" action={path.to.accountingPeriodsGenerate}>
          <ModalHeader>
            <ModalTitle>
              <Trans>Generate fiscal year</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Creates the 12 monthly periods for a fiscal year. Periods that
                already exist are kept.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="intent" value="generate" />
            <VStack spacing={2}>
              <div className="w-full">
                <label
                  htmlFor="fiscalYear"
                  className="text-sm font-medium block mb-1.5"
                >
                  <Trans>Fiscal year</Trans>
                </label>
                <Input
                  id="fiscalYear"
                  name="fiscalYear"
                  type="number"
                  min={2000}
                  max={2200}
                  value={Number.isNaN(year) ? "" : String(year)}
                  onChange={(e) => setYear(e.target.valueAsNumber)}
                />
              </div>
              {preview && (
                <p className="text-sm text-muted-foreground">
                  {preview} · {t`12 monthly periods`}
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button type="submit" isLoading={isBusy} isDisabled={!isValidYear}>
              <Trans>Generate</Trans>
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}
