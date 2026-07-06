import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { NotificationEvent } from "@carbon/notifications";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCompanies } from "~/modules/settings";
import { path } from "~/utils/path";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

async function resolve(
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  event: NotificationEvent,
  documentId: string,
  documentType?: ApprovalDocumentType
): Promise<string | null> {
  switch (event) {
    case NotificationEvent.TrainingAssignment: {
      // Group-based trainingAssignment row (/x/resources/assignments).
      // documentId is a `ta_*` id — look up the parent training so the
      // recipient lands on the training detail page.
      const assignment = await serviceRole
        .from("trainingAssignment")
        .select("trainingId")
        .eq("id", documentId)
        .maybeSingle();
      return assignment.data?.trainingId
        ? path.to.trainingAssignmentDetail(assignment.data.trainingId)
        : null;
    }
    case NotificationEvent.ResourceTrainingAssignment: {
      return path.to.training(documentId);
    }
    case NotificationEvent.JobAssignment:
    case NotificationEvent.JobCompleted:
      return path.to.job(documentId);
    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const [jobId, operationId, makeMethodId, materialId] =
        documentId.split(":");
      if (!jobId || !operationId || !makeMethodId) return null;
      const link = materialId
        ? path.to.jobMakeMethod(jobId, makeMethodId)
        : path.to.jobMethod(jobId, makeMethodId);
      return `${link}?selectedOperation=${operationId}`;
    }
    case NotificationEvent.PurchaseInvoiceAssignment:
      return path.to.purchaseInvoice(documentId);
    case NotificationEvent.PurchaseOrderAssignment:
      return path.to.purchaseOrder(documentId);
    case NotificationEvent.QuoteAssignment:
    case NotificationEvent.QuoteExpired:
    case NotificationEvent.DigitalQuoteResponse:
      return path.to.quote(documentId);
    case NotificationEvent.SupplierQuoteAssignment:
    case NotificationEvent.SupplierQuoteResponse:
      return path.to.supplierQuote(documentId);
    case NotificationEvent.SalesOrderAssignment:
      return path.to.salesOrder(documentId);
    case NotificationEvent.SalesRfqAssignment:
    case NotificationEvent.SalesRfqReady:
      return path.to.salesRfq(documentId);
    case NotificationEvent.MaintenanceDispatchAssignment:
    case NotificationEvent.MaintenanceDispatchCreated:
      return path.to.maintenanceDispatch(documentId);
    case NotificationEvent.GaugeCalibrationExpired:
      return path.to.gauge(documentId);
    case NotificationEvent.NonConformanceAssignment:
      return path.to.issue(documentId);
    case NotificationEvent.RiskAssignment:
      return path.to.risk(documentId);
    case NotificationEvent.ProcedureAssignment:
      return path.to.procedure(documentId);
    case NotificationEvent.StockTransferAssignment:
      return path.to.stockTransfer(documentId);
    case NotificationEvent.PickingListAssignment:
      return path.to.pickingList(documentId);
    case NotificationEvent.SuggestionResponse:
      return path.to.suggestion(documentId);
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected:
    case NotificationEvent.ApprovalRequested:
      if (documentType === "purchaseOrder")
        return path.to.purchaseOrder(documentId);
      if (documentType === "qualityDocument")
        return path.to.qualityDocument(documentId);
      if (documentType === "supplier")
        return path.to.supplierApproval(documentId);
      return null;
    default:
      return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    client,
    companyId: sessionCompanyId,
    userId
  } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const event = url.searchParams.get("event") as NotificationEvent | null;
  const documentId = url.searchParams.get("documentId");
  const documentType = url.searchParams.get(
    "documentType"
  ) as ApprovalDocumentType | null;

  const companyId = url.searchParams.get("companyId");

  if (!event || !documentId) {
    throw redirect(path.to.authenticatedRoot);
  }

  const serviceRole = getCarbonServiceRole();

  const link = await resolve(
    serviceRole,
    event,
    documentId,
    documentType ?? undefined
  );
  const redirectTo = link ?? path.to.authenticatedRoot;

  // The notification points at a document in a specific company, but the
  // recipient may currently be viewing a different one. If the linked company
  // is one the user belongs to, switch them into it before redirecting — the
  // same flow the company switcher uses — so the document actually resolves.
  if (companyId && companyId !== sessionCompanyId) {
    const companies = await getCompanies(client, userId);
    const matchedCompany = companies.data?.find(
      (company) => company.id === companyId
    );
    if (matchedCompany) {
      const sessionCookie = await updateCompanySession(
        request,
        companyId,
        matchedCompany.companyGroupId ?? ""
      );
      const companyIdCookie = setCompanyId(companyId);
      throw redirect(redirectTo, {
        headers: [
          ["Set-Cookie", sessionCookie],
          ["Set-Cookie", companyIdCookie]
        ]
      });
    }
  }

  throw redirect(redirectTo);
}
