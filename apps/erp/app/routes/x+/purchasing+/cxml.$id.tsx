import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
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
import { Form, Link, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getCxmlDocument,
  rejectCxmlDocument,
  releaseCxmlInvoice
} from "~/modules/purchasing";
import { CxmlDocumentStatus } from "~/modules/purchasing/ui/Cxml";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { id } = params;
  if (!id) throw new Error("id is not found");

  const document = await getCxmlDocument(client, id, companyId);
  if (!document.data) throw new Error("cXML document not found");

  return { document: document.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { update: "purchasing" });
  const { id } = params;
  if (!id) throw new Error("id is not found");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reject") {
    const result = await rejectCxmlDocument(client, { id, companyId, userId });
    if (result.error) {
      throw redirect(
        path.to.cxmlDocuments,
        await flash(request, error(result.error, "Failed to reject document"))
      );
    }
    throw redirect(
      path.to.cxmlDocuments,
      await flash(request, success("Document rejected"))
    );
  }

  if (intent === "create-invoice") {
    const result = await releaseCxmlInvoice(client, {
      id,
      companyId,
      userId,
      companyGroupId
    });
    if (result.error || !result.data) {
      throw redirect(
        path.to.cxmlDocument(id),
        await flash(request, error(result.error, "Failed to create invoice"))
      );
    }
    throw redirect(
      path.to.purchaseInvoice(result.data.purchaseInvoiceId),
      await flash(request, success("Draft purchase invoice created"))
    );
  }

  if (intent === "resend") {
    const document = await getCxmlDocument(client, id, companyId);
    if (!document.data?.purchaseOrderId) {
      throw redirect(
        path.to.cxmlDocument(id),
        await flash(request, error("Document has no purchase order to resend"))
      );
    }
    await trigger("punchout-send-po", {
      companyId,
      purchaseOrderId: document.data.purchaseOrderId,
      userId
    });
    throw redirect(
      path.to.cxmlDocuments,
      await flash(request, success("Resending purchase order"))
    );
  }

  throw redirect(path.to.cxmlDocuments);
}

export default function CxmlDocumentDetailRoute() {
  const { document } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();

  const issues = Array.isArray(document.issues)
    ? (document.issues as string[])
    : [];
  const isInvoice =
    document.documentType === "Invoice" ||
    document.documentType === "Credit Memo";
  const canCreateInvoice = isInvoice && document.status === "Needs Review";
  const canReject = document.status === "Needs Review";
  const canResend =
    document.direction === "Outbound" && document.status === "Failed";

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.cxmlDocuments);
      }}
    >
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>
            {document.documentType}
            {document.externalId ? ` · ${document.externalId}` : ""}
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <HStack>
              <CxmlDocumentStatus status={document.status} />
              <Badge variant="secondary">{document.direction}</Badge>
            </HStack>

            {document.purchaseOrderId && (
              <Link
                className="text-sm text-primary underline"
                to={path.to.purchaseOrder(document.purchaseOrderId)}
              >
                {document.purchaseOrderId}
              </Link>
            )}

            {issues.length > 0 && (
              <VStack spacing={1}>
                <span className="text-sm font-medium">
                  <Trans>Issues</Trans>
                </span>
                {issues.map((issue) => (
                  <span key={issue} className="text-xs text-muted-foreground">
                    {issue}
                  </span>
                ))}
              </VStack>
            )}

            <VStack spacing={1}>
              <span className="text-sm font-medium">
                <Trans>Payload</Trans>
              </span>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-[50vh]">
                {JSON.stringify(document.payload, null, 2)}
              </pre>
            </VStack>
          </VStack>
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            {canCreateInvoice && (
              <Form method="post">
                <input type="hidden" name="intent" value="create-invoice" />
                <Button type="submit">{t`Create invoice`}</Button>
              </Form>
            )}
            {canResend && (
              <Form method="post">
                <input type="hidden" name="intent" value="resend" />
                <Button type="submit" variant="secondary">
                  {t`Resend`}
                </Button>
              </Form>
            )}
            {canReject && (
              <Form method="post">
                <input type="hidden" name="intent" value="reject" />
                <Button type="submit" variant="destructive">
                  {t`Reject`}
                </Button>
              </Form>
            )}
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
