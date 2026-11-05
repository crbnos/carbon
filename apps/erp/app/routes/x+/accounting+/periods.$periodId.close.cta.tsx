// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useCurrencyFormatter } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Currency Translation`,
  to: path.to.accountingPeriods
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");
  const api = await carbon(request);
  const preview = await api.accounting.previewCurrencyTranslation({
    periodId
  });
  if (preview.error || !preview.data) {
    throw redirect(
      path.to.accountingPeriodClose(periodId),
      await flash(
        request,
        error(
          preview.error,
          preview.error?.message ??
            "Failed to preview the currency translation adjustment"
        )
      )
    );
  }
  return { preview: preview.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");
  const api = await carbon(request);
  const result = await api.accounting.postCurrencyTranslation({ periodId });
  return respond(request, result).redirect(
    path.to.accountingPeriodClose(periodId),
    {
      message: result.data?.posted
        ? "Currency translation adjustment posted"
        : "Nothing to post: the CTA is already up to date"
    }
  );
}

export default function CurrencyTranslationRoute() {
  const { preview } = useLoaderData<typeof loader>();
  const { periodId } = useParams();
  const navigate = useNavigate();
  const fetcher = useAction<typeof action>();
  const currencyFormatter = useCurrencyFormatter();
  const isBusy = fetcher.state !== "idle";
  const onClose = () => navigate(path.to.accountingPeriodClose(periodId!));

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="small">
        <ModalHeader>
          <ModalTitle>
            <Trans>Currency Translation Adjustment</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Posts the change in the consolidated CTA to equity on the
              elimination company.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {!preview.applicable ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                Every company in the group uses this company's currency, so
                there is no translation adjustment.
              </Trans>
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">
                  <Trans>Consolidated CTA</Trans>
                </dt>
                <dd className="text-right tabular-nums">
                  {currencyFormatter.format(preview.liveCta)}
                </dd>
                <dt className="text-muted-foreground">
                  <Trans>Already posted</Trans>
                </dt>
                <dd className="text-right tabular-nums">
                  {currencyFormatter.format(preview.postedCta)}
                </dd>
                <dt className="font-medium">
                  <Trans>To post</Trans>
                </dt>
                <dd className="text-right font-medium tabular-nums">
                  {currencyFormatter.format(preview.movement)}
                </dd>
              </dl>
              {preview.unrevaluedCompanies.length > 0 && (
                <Alert variant="warning">
                  <LuTriangleAlert />
                  <AlertTitle>
                    <Trans>Revalue these companies first</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      They have no posted currency revaluation run for this
                      period, so their balances are not at the closing rate:
                    </Trans>{" "}
                    {preview.unrevaluedCompanies
                      .map((company) => company.name)
                      .join(", ")}
                  </AlertDescription>
                </Alert>
              )}
              {preview.averageRateAccounts.length > 0 && (
                <Alert variant="warning">
                  <LuTriangleAlert />
                  <AlertTitle>
                    <Trans>Check these accounts' consolidation rate</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      These asset and liability accounts translate at the
                      Average rate, which moves the CTA. Balance sheet accounts
                      usually translate at the Current rate:
                    </Trans>{" "}
                    {preview.averageRateAccounts
                      .map((account) =>
                        account.number
                          ? `${account.number} ${account.name}`
                          : account.name
                      )
                      .join(", ")}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          {preview.applicable && preview.movement !== 0 && (
            <fetcher.Form method="post">
              <Button type="submit" isLoading={isBusy} isDisabled={isBusy}>
                <Trans>Post CTA</Trans>
              </Button>
            </fetcher.Form>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
