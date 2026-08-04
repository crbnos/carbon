import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { EdiIssue, EdiOrderPayload } from "@carbon/ee/edi";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { Hyperlink } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { CustomerLocation, Hidden, Item, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { upsertItemCustomerPart } from "~/modules/items";
import {
  ediTradingPartnerLocationValidator,
  getEdiDocument,
  refreshEdiDocumentIssues,
  rejectEdiDocument,
  releaseEdiDocument,
  upsertEdiTradingPartnerLocation
} from "~/modules/sales";
import EdiDocumentStatus from "~/modules/sales/ui/Edi/EdiDocumentStatus";
import { path } from "~/utils/path";

const mapPartFormValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  customerPartId: z.string(),
  customerPartRevision: zfd.text(z.string().optional())
});

const sourceDocumentTables = {
  "Sales Order": "salesOrder",
  Shipment: "shipment",
  "Sales Invoice": "salesInvoice"
} as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const doc = await getEdiDocument(client, id, companyId);
  if (doc.error || !doc.data) {
    throw redirect(
      path.to.ediDocuments,
      await flash(request, error(doc.error, "Failed to load EDI document"))
    );
  }

  return { doc: doc.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "release") {
    const result = await releaseEdiDocument(client, { id, companyId, userId });
    if (result.error) {
      return data(
        {},
        await flash(
          request,
          error(result.error, "Failed to release EDI document")
        )
      );
    }
    if (result.data?.issues && result.data.issues.length > 0) {
      const messages = result.data.issues
        .map((issue) => issue.message)
        .join("; ");
      return data(
        {},
        await flash(request, error(null, `Cannot release: ${messages}`))
      );
    }
    throw redirect(
      path.to.ediDocument(id),
      await flash(request, success("EDI document released"))
    );
  }

  if (intent === "reject") {
    const result = await rejectEdiDocument(client, { id, companyId, userId });
    if (result.error) {
      return data(
        {},
        await flash(
          request,
          error(result.error, "Failed to reject EDI document")
        )
      );
    }
    throw redirect(
      path.to.ediDocuments,
      await flash(request, success("EDI document rejected"))
    );
  }

  if (intent === "retry") {
    const doc = await getEdiDocument(client, id, companyId);
    if (doc.error || !doc.data) {
      return data(
        {},
        await flash(request, error(doc.error, "Failed to load EDI document"))
      );
    }
    const table = doc.data.sourceDocument
      ? sourceDocumentTables[
          doc.data.sourceDocument as keyof typeof sourceDocumentTables
        ]
      : undefined;
    if (!table || !doc.data.sourceDocumentId) {
      return data(
        {},
        await flash(
          request,
          error(null, "Cannot retry: missing source document")
        )
      );
    }
    await trigger("edi-send-document", {
      companyId,
      table,
      recordId: doc.data.sourceDocumentId,
      documentType: doc.data.documentType
    });
    throw redirect(
      path.to.ediDocument(id),
      await flash(request, success("Retry queued"))
    );
  }

  if (intent === "map-part") {
    const validation = await validator(mapPartFormValidator).validate(formData);
    if (validation.error) return validationError(validation.error);

    const doc = await getEdiDocument(client, id, companyId);
    if (doc.error || !doc.data) {
      return data(
        {},
        await flash(request, error(doc.error, "Failed to load EDI document"))
      );
    }
    const customerId = doc.data.ediTradingPartner?.customerId;
    if (!customerId) {
      return data(
        {},
        await flash(request, error(null, "No customer for this document"))
      );
    }

    const upsert = await upsertItemCustomerPart(client, {
      itemId: validation.data.itemId,
      customerId,
      customerPartId: validation.data.customerPartId,
      customerPartRevision: validation.data.customerPartRevision,
      companyId
    });
    if (upsert.error) {
      return data(
        {},
        await flash(request, error(upsert.error, "Failed to map part"))
      );
    }

    await refreshEdiDocumentIssues(client, { id, companyId, userId });
    throw redirect(
      path.to.ediDocument(id),
      await flash(request, success("Part mapped"))
    );
  }

  if (intent === "map-location") {
    const validation = await validator(
      ediTradingPartnerLocationValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);

    const doc = await getEdiDocument(client, id, companyId);
    if (doc.error || !doc.data || !doc.data.tradingPartnerId) {
      return data(
        {},
        await flash(
          request,
          error(null, "No trading partner for this document")
        )
      );
    }

    const { id: _locationId, ...locationData } = validation.data;
    const upsert = await upsertEdiTradingPartnerLocation(client, {
      ...locationData,
      tradingPartnerId: doc.data.tradingPartnerId,
      companyId,
      createdBy: userId
    });
    if (upsert.error) {
      return data(
        {},
        await flash(request, error(upsert.error, "Failed to map location"))
      );
    }

    await refreshEdiDocumentIssues(client, { id, companyId, userId });
    throw redirect(
      path.to.ediDocument(id),
      await flash(request, success("Location mapped"))
    );
  }

  return data({}, await flash(request, error(null, "Unknown action")));
}

function MapPartForm({ partnerPartId }: { partnerPartId: string }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  return (
    <ValidatedForm
      method="post"
      fetcher={fetcher}
      validator={mapPartFormValidator}
      defaultValues={{ itemId: "", customerPartId: partnerPartId }}
      className="w-full"
    >
      <Hidden name="intent" value="map-part" />
      <Hidden name="customerPartId" value={partnerPartId} />
      <HStack className="items-end w-full" spacing={2}>
        <div className="flex-1">
          <Item name="itemId" label={t`Map to item`} type="Item" />
        </div>
        <Submit size="sm">
          <Trans>Map</Trans>
        </Submit>
      </HStack>
    </ValidatedForm>
  );
}

function MapLocationForm({
  externalCode,
  customerId
}: {
  externalCode: string;
  customerId?: string;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  return (
    <ValidatedForm
      method="post"
      fetcher={fetcher}
      validator={ediTradingPartnerLocationValidator}
      defaultValues={{ externalCode, customerLocationId: "" }}
      className="w-full"
    >
      <Hidden name="intent" value="map-location" />
      <Hidden name="externalCode" value={externalCode} />
      <HStack className="items-end w-full" spacing={2}>
        <div className="flex-1">
          <CustomerLocation
            name="customerLocationId"
            label={t`Map to location`}
            customer={customerId}
          />
        </div>
        <Submit size="sm">
          <Trans>Map</Trans>
        </Submit>
      </HStack>
    </ValidatedForm>
  );
}

export default function EdiDocumentRoute() {
  const { doc } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const actionFetcher = useFetcher<{}>();

  const canUpdate = permissions.can("update", "sales");

  const issues = Array.isArray(doc.issues)
    ? (doc.issues as unknown as EdiIssue[])
    : [];
  const payload = doc.payload as unknown as EdiOrderPayload | null;
  const isInboundOrder =
    doc.direction === "Inbound" && doc.documentType === "Purchase Order";
  const canReview = doc.status === "Needs Review" || doc.status === "Received";
  const canRetry = doc.direction === "Outbound" && doc.status === "Failed";
  const customerId = doc.ediTradingPartner?.customerId ?? undefined;
  const customerName = doc.ediTradingPartner?.customer?.name;

  const sourceDocumentPath = (() => {
    if (!doc.sourceDocumentId || !doc.sourceDocument) return null;
    switch (doc.sourceDocument) {
      case "Sales Order":
        return path.to.salesOrderDetails(doc.sourceDocumentId);
      case "Shipment":
        return path.to.shipmentDetails(doc.sourceDocumentId);
      case "Sales Invoice":
        return path.to.salesInvoiceDetails(doc.sourceDocumentId);
      default:
        return null;
    }
  })();

  const showFooter = canUpdate && (canReview || canRetry);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.ediDocuments);
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Enumerable value={doc.documentType} />
          </DrawerTitle>
          <HStack spacing={2} className="pt-2">
            <EdiDocumentStatus status={doc.status} />
            <Enumerable value={doc.direction} />
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <div className="grid grid-cols-2 gap-4 w-full text-sm">
              {customerName && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground">{t`Customer`}</span>
                  <span className="font-medium">{customerName}</span>
                </div>
              )}
              {doc.partnerReference && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground">
                    {t`Partner Reference`}
                  </span>
                  <span className="font-medium">{doc.partnerReference}</span>
                </div>
              )}
              {sourceDocumentPath && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground">
                    {t`Linked Record`}
                  </span>
                  <Hyperlink to={sourceDocumentPath}>
                    {doc.sourceDocumentReadableId ?? doc.sourceDocumentId}
                  </Hyperlink>
                </div>
              )}
            </div>

            <VStack spacing={2} className="w-full">
              <p className="text-sm font-medium">{t`Issues`}</p>
              {issues.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>No issues</Trans>
                </p>
              ) : (
                <div className="flex flex-col w-full border rounded-lg divide-y">
                  {issues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${index}`}
                      className="flex flex-col gap-2 p-3"
                    >
                      <HStack spacing={2}>
                        <Badge variant="red">{issue.code}</Badge>
                        <span className="text-sm">{issue.message}</span>
                      </HStack>
                      {canUpdate &&
                        issue.code === "unknown-part" &&
                        issue.context?.partnerPartId && (
                          <MapPartForm
                            partnerPartId={String(issue.context.partnerPartId)}
                          />
                        )}
                      {canUpdate &&
                        issue.code === "unknown-ship-to" &&
                        issue.context?.code && (
                          <MapLocationForm
                            externalCode={String(issue.context.code)}
                            customerId={customerId}
                          />
                        )}
                    </div>
                  ))}
                </div>
              )}
            </VStack>

            {isInboundOrder && payload?.lines && payload.lines.length > 0 && (
              <VStack spacing={2} className="w-full">
                <p className="text-sm font-medium">{t`Lines`}</p>
                <div className="w-full border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2 font-medium">
                          {t`Buyer Part`}
                        </th>
                        <th className="text-right p-2 font-medium">
                          {t`Quantity`}
                        </th>
                        <th className="text-right p-2 font-medium">
                          {t`Unit Price`}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {payload.lines.map((line, index) => (
                        <tr key={`${line.partnerPartId}-${index}`}>
                          <td className="p-2 font-mono">
                            {line.partnerPartId}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {line.quantity}
                          </td>
                          <td className="p-2 text-right tabular-nums">
                            {line.unitPrice}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </VStack>
            )}

            <details className="w-full">
              <summary className="text-sm font-medium cursor-pointer text-muted-foreground">
                {t`Raw Payload`}
              </summary>
              <pre className="mt-2 p-3 text-xs bg-muted rounded-lg overflow-auto max-h-96">
                {JSON.stringify(doc.payload, null, 2)}
              </pre>
            </details>
          </VStack>
        </DrawerBody>
        {showFooter && (
          <DrawerFooter>
            <HStack spacing={2}>
              {canUpdate && canReview && isInboundOrder && (
                <actionFetcher.Form method="post">
                  <input type="hidden" name="intent" value="release" />
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={actionFetcher.state !== "idle"}
                    isDisabled={actionFetcher.state !== "idle"}
                  >
                    <Trans>Release</Trans>
                  </Button>
                </actionFetcher.Form>
              )}
              {canUpdate && canRetry && (
                <actionFetcher.Form method="post">
                  <input type="hidden" name="intent" value="retry" />
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={actionFetcher.state !== "idle"}
                    isDisabled={actionFetcher.state !== "idle"}
                  >
                    <Trans>Retry</Trans>
                  </Button>
                </actionFetcher.Form>
              )}
              {canUpdate && canReview && (
                <actionFetcher.Form method="post">
                  <input type="hidden" name="intent" value="reject" />
                  <Button
                    type="submit"
                    variant="destructive"
                    isDisabled={actionFetcher.state !== "idle"}
                  >
                    <Trans>Reject</Trans>
                  </Button>
                </actionFetcher.Form>
              )}
            </HStack>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}
