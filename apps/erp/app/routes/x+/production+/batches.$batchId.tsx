import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPrinter } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { DateTime } from "~/components";
import { getJobOperationBatchWithMembers } from "~/modules/production";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { batchId } = params;
  if (!batchId) throw notFound("batchId not found");

  const batch = await getJobOperationBatchWithMembers(
    client,
    batchId,
    companyId
  );
  if (batch.error || !batch.data) {
    throw redirect(
      path.to.operationBatches,
      await flash(request, error(batch.error, "Failed to get batch"))
    );
  }

  return { batch: batch.data };
}

export default function BatchRoute() {
  const { batch } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();

  const isLive = batch.status === "Active" || batch.status === "Completing";

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <DrawerContent size="md">
        <DrawerHeader>
          <DrawerTitle>{batch.readableId}</DrawerTitle>
          <HStack spacing={2} className="pt-1">
            <Badge
              variant={
                batch.status === "Completed"
                  ? "green"
                  : batch.status === "Completing"
                    ? "yellow"
                    : "secondary"
              }
            >
              {batch.status}
            </Badge>
            {batch.process?.name && (
              <span className="text-sm text-muted-foreground">
                {batch.process.name}
              </span>
            )}
            {batch.workCenter?.name && (
              <span className="text-sm text-muted-foreground">
                {batch.workCenter.name}
              </span>
            )}
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <div className="text-sm text-muted-foreground">
              <Trans>Created</Trans>{" "}
              <DateTime value={batch.createdAt} variant="date" />
            </div>
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Job</Trans>
                  </Th>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {batch.members.map((member) => (
                  <Tr key={member.id}>
                    <Td className="font-medium">
                      {member.job?.id ? (
                        <Link
                          to={path.to.jobDetails(member.job.id)}
                          className="hover:underline"
                        >
                          {member.job.jobId}
                        </Link>
                      ) : (
                        member.job?.jobId
                      )}
                    </Td>
                    <Td className="text-muted-foreground">
                      {member.jobMakeMethod?.item?.readableIdWithRevision ??
                        member.description}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {member.operationQuantity ?? 0}
                    </Td>
                    <Td>{member.status}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            <Button variant="secondary" leftIcon={<LuPrinter />} asChild>
              <a
                href={path.to.file.batchLoadList(batch.id)}
                target="_blank"
                rel="noreferrer"
              >
                {t`Print load list`}
              </a>
            </Button>
            {isLive && (
              <Button variant="secondary" asChild>
                <Link to={path.to.scheduleOperation}>
                  {t`View on schedule board`}
                </Link>
              </Button>
            )}
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
