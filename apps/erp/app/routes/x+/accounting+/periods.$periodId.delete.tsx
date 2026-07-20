import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
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
import { formatPeriodLabel } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuTrash, LuTriangleAlert } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import {
  deleteAccountingPeriod,
  getAccountingPeriodDeletability
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Delete Period",
  to: path.to.accountingPeriods
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const check = await getAccountingPeriodDeletability(
    client,
    periodId,
    companyId
  );
  if (check.error || !check.data) {
    throw redirect(
      path.to.accountingPeriods,
      await flash(request, error(check.error, "Failed to load period"))
    );
  }

  return { check: check.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { periodId } = params;
  if (!periodId) throw notFound("periodId not found");

  const result = await deleteAccountingPeriod(client, { periodId, companyId });
  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, result.error.message ?? "Failed to delete period")
      )
    );
  }

  throw redirect(
    path.to.accountingPeriods,
    await flash(request, success("Period deleted"))
  );
}

export default function DeleteAccountingPeriodRoute() {
  const { check } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();

  const periodLabel = formatPeriodLabel(check.startDate);
  const isBusy = fetcher.state !== "idle";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.accountingPeriods);
      }}
    >
      <ModalContent size="small">
        <ModalHeader>
          <ModalTitle>
            <Trans>Delete {periodLabel}</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>Only empty, open periods can be deleted.</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {check.canDelete ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                This period has no journal entries posted to it and can be
                permanently deleted. This cannot be undone.
              </Trans>
            </p>
          ) : (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Can't delete this period</Trans>
              </AlertTitle>
              <AlertDescription>{check.reason}</AlertDescription>
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => navigate(path.to.accountingPeriods)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form method="post">
            <Button
              type="submit"
              variant="destructive"
              leftIcon={<LuTrash />}
              isDisabled={!check.canDelete}
              isLoading={isBusy}
            >
              <Trans>Delete Period</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
