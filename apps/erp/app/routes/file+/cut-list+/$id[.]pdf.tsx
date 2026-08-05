import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { CutListPDF } from "@carbon/documents/pdf";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import {
  getCutList,
  getCutListLines,
  getCutPatterns
} from "~/modules/production/production.service";
import { getCompany } from "~/modules/settings";

const logger = getLogger("erp", "cut-list", "pdf");

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Deliberately permission-free like the job traveler: the shop floor needs
  // to print this. The companyId check below is what enforces tenancy.
  const { companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find cut list id");

  const serviceRole = await getCarbonServiceRole();

  const cutList = await getCutList(serviceRole, id, companyId);
  if (cutList.error || !cutList.data) {
    logger.error("Failed to load cut list", { error: cutList.error });
    throw new Error("Failed to load cut list");
  }

  const [company, lines, patterns] = await Promise.all([
    getCompany(serviceRole, companyId),
    getCutListLines(serviceRole, id, companyId),
    getCutPatterns(serviceRole, id, companyId)
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
    throw new Error("Failed to load company");
  }

  const lineRows = lines.data ?? [];
  const itemById = new Map(
    lineRows.map((line) => {
      const item = line.item as {
        readableIdWithRevision?: string | null;
      } | null;
      return [line.id, item?.readableIdWithRevision ?? null];
    })
  );

  const { locale } = getPreferenceHeaders(request);

  const stream = await renderToStream(
    <CutListPDF
      company={company.data as never}
      locale={locale}
      cutList={{
        cutListId: cutList.data.cutListId!,
        status: cutList.data.status!,
        processName: cutList.data.processName,
        locationName: cutList.data.locationName,
        kerf: Number(cutList.data.kerf ?? 0),
        endTrim: Number(cutList.data.endTrim ?? 0),
        gripMargin: Number(cutList.data.gripMargin ?? 0),
        minRemnantLength: Number(cutList.data.minRemnantLength ?? 0),
        unitOfDimension: cutList.data.unitOfDimension ?? "in",
        plannedYieldPct:
          cutList.data.plannedYieldPct === null
            ? null
            : Number(cutList.data.plannedYieldPct)
      }}
      lines={lineRows.map((line) => {
        const item = line.item as {
          readableIdWithRevision?: string | null;
          name?: string | null;
        } | null;
        const job = line.job as { jobId?: string | null } | null;
        return {
          id: line.id!,
          itemReadableId: item?.readableIdWithRevision ?? null,
          description: item?.name ?? null,
          pieceLength: Number(line.pieceLength),
          pieceWidth: line.pieceWidth === null ? null : Number(line.pieceWidth),
          quantity: line.quantity,
          quantityCut: line.quantityCut,
          jobReadableId: job?.jobId ?? null
        };
      })}
      patterns={(patterns.data ?? []).map((pattern) => {
        const item = pattern.item as {
          readableIdWithRevision?: string | null;
        } | null;
        const entity = pattern.trackedEntity as {
          readableId?: string | null;
        } | null;
        const cuts = (pattern.pattern ?? []) as {
          cutListLineId: string;
          pieceLength: number;
        }[];
        return {
          id: pattern.id!,
          sequence: pattern.sequence,
          stockReadableId: item?.readableIdWithRevision ?? null,
          lotReadableId: entity?.readableId ?? null,
          stockLength:
            pattern.stockLength === null ? null : Number(pattern.stockLength),
          expectedRemnant:
            pattern.expectedRemnant === null
              ? null
              : Number(pattern.expectedRemnant),
          cuts: cuts.map((cut) => ({
            pieceLength: cut.pieceLength,
            itemReadableId: itemById.get(cut.cutListLineId) ?? null
          }))
        };
      })}
      meta={{
        author: "Carbon",
        keywords: "cut list, manufacturing",
        subject: "Cut List"
      }}
      title="Cut List"
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${cutList.data.cutListId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
