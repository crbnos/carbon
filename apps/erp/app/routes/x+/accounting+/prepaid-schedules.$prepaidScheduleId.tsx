import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuBan } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { getPrepaidSchedule } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { prepaidScheduleId } = params;
  if (!prepaidScheduleId) throw notFound("prepaidScheduleId not found");

  const schedule = await getPrepaidSchedule(client, prepaidScheduleId);
  if (schedule.error || !schedule.data) {
    throw redirect(
      path.to.prepaidSchedules,
      await flash(
        request,
        error(schedule.error, "Failed to get prepaid schedule")
      )
    );
  }

  return { schedule: schedule.data };
}

export default function PrepaidScheduleDetailRoute() {
  const { schedule } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const cancelModal = useDisclosure();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const entries = (schedule.prepaidScheduleEntry ?? [])
    .slice()
    .sort((a, b) => a.amortizationDate.localeCompare(b.amortizationDate));

  const amortized = entries
    .filter((e) => e.journalId != null)
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const remaining = Number(schedule.totalAmount ?? 0) - amortized;

  const hasPosted = entries.some((e) => e.journalId != null);
  const canCancel =
    schedule.status === "Active" &&
    !hasPosted &&
    permissions.can("update", "accounting");

  const statusColor =
    schedule.status === "Active"
      ? "green"
      : schedule.status === "Complete"
        ? "blue"
        : "gray";

  return (
    <VStack spacing={4} className="p-4 w-full">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <HStack>
            <Heading size="h3">{schedule.description}</Heading>
            <Status color={statusColor}>{schedule.status}</Status>
          </HStack>
          {canCancel && (
            <Button
              variant="destructive"
              leftIcon={<LuBan />}
              onClick={cancelModal.onOpen}
            >
              <Trans>Cancel Schedule</Trans>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <VStack spacing={1}>
              <span className="text-sm text-muted-foreground">
                <Trans>Total</Trans>
              </span>
              <span className="font-mono tabular-nums">
                {currencyFormatter.format(Number(schedule.totalAmount ?? 0))}
              </span>
            </VStack>
            <VStack spacing={1}>
              <span className="text-sm text-muted-foreground">
                <Trans>Amortized</Trans>
              </span>
              <span className="font-mono tabular-nums">
                {currencyFormatter.format(amortized)}
              </span>
            </VStack>
            <VStack spacing={1}>
              <span className="text-sm text-muted-foreground">
                <Trans>Remaining</Trans>
              </span>
              <span className="font-mono tabular-nums">
                {currencyFormatter.format(remaining)}
              </span>
            </VStack>
            <VStack spacing={1}>
              <span className="text-sm text-muted-foreground">
                <Trans>Start Date</Trans>
              </span>
              <span>{formatDate(schedule.startDate)}</span>
            </VStack>
            <VStack spacing={1}>
              <span className="text-sm text-muted-foreground">
                <Trans>Months</Trans>
              </span>
              <span>{schedule.months}</span>
            </VStack>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Amortization Entries</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <Thead>
              <Tr>
                <Th>{t`Date`}</Th>
                <Th className="text-right">{t`Amount`}</Th>
                <Th>{t`Posted`}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {entries.map((entry) => (
                <Tr key={entry.id}>
                  <Td>{formatDate(entry.amortizationDate)}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {currencyFormatter.format(Number(entry.amount ?? 0))}
                  </Td>
                  <Td>
                    {entry.journalId ? (
                      <Link
                        className="text-primary hover:underline"
                        to={path.to.journalEntryDetails(entry.journalId)}
                      >
                        <Trans>Posted</Trans>
                      </Link>
                    ) : (
                      <Status color="gray">
                        <Trans>Pending</Trans>
                      </Status>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      {canCancel && (
        <Confirm
          action={path.to.prepaidScheduleCancel(schedule.id)}
          isOpen={cancelModal.isOpen}
          title={t`Cancel prepaid schedule`}
          text={t`Are you sure you want to cancel this prepaid schedule? This can only be done before any amortization has posted.`}
          confirmText={t`Cancel Schedule`}
          confirmVariant="destructive"
          onCancel={cancelModal.onClose}
          onSubmit={cancelModal.onClose}
        />
      )}
    </VStack>
  );
}
