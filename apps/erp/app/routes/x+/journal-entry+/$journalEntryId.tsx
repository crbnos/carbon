import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import {
  getActiveDimensionsWithValues,
  getCompaniesInGroup,
  getJournalEntry,
  getJournalLineDimensions
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Journal Entries",
  to: path.to.accountingJournals
};

// Maps a journal's sourceType to the document it was posted from, so the
// details screen can link back to it (like the Sales Order button on an
// invoice). `Manual` entries and unmapped sources show no link.
const journalSourceDocumentMap: Record<
  string,
  { table: string; column: string; to: (id: string) => string }
> = {
  Payment: {
    table: "payment",
    column: "paymentId",
    to: (id) => path.to.payment(id)
  },
  "Sales Invoice": {
    table: "salesInvoice",
    column: "invoiceId",
    to: (id) => path.to.salesInvoiceDetails(id)
  },
  "Purchase Invoice": {
    table: "purchaseInvoice",
    column: "invoiceId",
    to: (id) => path.to.purchaseInvoiceDetails(id)
  },
  "Sales Shipment": {
    table: "shipment",
    column: "shipmentId",
    to: (id) => path.to.shipmentDetails(id)
  },
  "Purchase Receipt": {
    table: "receipt",
    column: "receiptId",
    to: (id) => path.to.receiptDetails(id)
  }
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting"
    }
  );

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const [journalEntry, companies, dimensions] = await Promise.all([
    getJournalEntry(client, journalEntryId),
    getCompaniesInGroup(client, companyGroupId),
    getActiveDimensionsWithValues(client, companyGroupId, companyId)
  ]);

  if (journalEntry.error) {
    throw redirect(
      path.to.accountingJournals,
      await flash(
        request,
        error(journalEntry.error, "Failed to load journal entry")
      )
    );
  }

  if (journalEntry.data.companyId !== companyId) {
    throw redirect(path.to.accountingJournals);
  }

  const journalLineIds = (journalEntry.data.journalLine ?? []).map((l) => l.id);
  const lineDimensions = await getJournalLineDimensions(client, journalLineIds);

  // Resolve the source document (if any) so the screen can link back to it.
  const sourceType = journalEntry.data.sourceType;
  const documentId =
    (journalEntry.data.journalLine ?? []).find((l) => l.documentId)
      ?.documentId ?? null;
  let sourceDocument: { readableId: string; to: string } | null = null;
  if (sourceType && sourceType !== "Manual" && documentId) {
    const spec = journalSourceDocumentMap[sourceType];
    if (spec) {
      const doc = await client
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(spec.table as any)
        .select(`id, ${spec.column}`)
        .eq("id", documentId)
        .maybeSingle();
      if (doc.data) {
        sourceDocument = {
          readableId: (doc.data as unknown as Record<string, string>)[
            spec.column
          ],
          to: spec.to(documentId)
        };
      }
    }
  }

  return {
    journalEntry: journalEntry.data,
    companies: companies.data ?? [],
    dimensions: dimensions.data ?? [],
    lineDimensions: lineDimensions.data ?? {},
    sourceDocument
  };
}

export default function JournalEntryRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <Outlet />
      </div>
    </div>
  );
}
