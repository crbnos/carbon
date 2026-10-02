// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isStorageNotFound, isUnsafeStoragePath, storage } from "@carbon/files";
import { renderPdfPageAsPng } from "@carbon/files/pdf/node";
import { getLogger } from "@carbon/logger";
import {
  getInspection,
  getInspectionDrawingStoragePath
} from "~/services/quality.service";
import { apiRoute } from "./lib/route.server";

const log = getLogger("mes", "inspection-drawing");

/**
 * One page of an inspection lot's drawing, as a PNG.
 *
 * **Why an image.** The web pane opens the PDF with `react-pdf` and draws the
 * balloons on a `react-konva` canvas; both are DOM-only, so a native client
 * has no engine to open a PDF with at all. Rather than ship one (every option
 * is a native module, which would end Expo Go and put an Apple Developer
 * account between an inspector and a test build), the page is rasterised here
 * and the balloons are drawn natively on top from the normalized coordinates
 * in `screen.drawing.balloons`. Being normalized 0–1 is what makes that sound:
 * `scale` buys detail to pinch into and cannot move where a balloon lands.
 *
 * The cost is honest: it is an image, so there is no text selection and no
 * vector zoom past the rendered resolution. Hence the default scale of 3 —
 * enough that a balloon number and a dimension are legible on a tablet after
 * pinching.
 *
 * Gated on being an employee of the company, matching the screen read it
 * belongs to (`GET /operations/:id/inspection`) and the web loader's own
 * `requirePermissions(request, {})`. A tighter gate would mean an inspector
 * could see the drawing in a browser but not on the tablet they are holding.
 */
const MAX_SCALE = 4;
const DEFAULT_SCALE = 3;
/** Pages are 1-based, as `balloon.pageNumber` is. */
const MAX_PAGE = 2000;

export const loader = apiRoute(
  { method: "GET" },
  async ({ request, params, user }) => {
    if (!user) {
      throw new Error("unreachable: /inspections/:id/drawing is not public");
    }

    const inspectionId = params.id;
    if (!inspectionId) {
      throw new ApiError(400, "validation_failed", "No inspection was given");
    }

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
      throw new ApiError(
        400,
        "validation_failed",
        "Page must be a page number"
      );
    }
    const requestedScale = Number(
      url.searchParams.get("scale") ?? DEFAULT_SCALE
    );
    // Clamped rather than refused: a client asking for more detail than the
    // server will spend is not an error, and an unbounded scale is a way to
    // ask one request to render a 40-megapixel canvas.
    const scale =
      Number.isFinite(requestedScale) && requestedScale > 0
        ? Math.min(requestedScale, MAX_SCALE)
        : DEFAULT_SCALE;

    const serviceRole = await getCarbonServiceRole();

    // The lot, under the caller's company. The id comes from the URL, so this
    // is the scope check — without it any lot id in any tenant would resolve a
    // document id, and the drawing read below would be handed it.
    const lot = await getInspection(serviceRole, inspectionId);
    // `getInspection` is typed `any` (it selects `*` plus two embeds), so the
    // compiler cannot check this comparison — the narrowing is written out so
    // that the one line standing between two tenants is not an `any` field
    // access a rename could silently turn into `undefined !== undefined`.
    const row = lot.data as
      | { companyId?: unknown; inspectionDocumentId?: unknown }
      | null
      | undefined;
    const lotCompanyId =
      typeof row?.companyId === "string" ? row.companyId : null;
    if (lot.error || !lotCompanyId || lotCompanyId !== user.companyId) {
      throw new ApiError(404, "not_found", "Inspection not found");
    }

    const documentId =
      typeof row?.inspectionDocumentId === "string"
        ? row.inspectionDocumentId
        : null;
    if (!documentId) {
      throw new ApiError(404, "not_found", "This lot has no drawing");
    }

    const document = await getInspectionDrawingStoragePath(
      serviceRole,
      documentId,
      user.companyId
    );
    const storagePath = document.data?.storagePath ?? null;
    if (document.error || !storagePath) {
      throw new ApiError(404, "not_found", "This lot has no drawing");
    }

    // The path is this company's own row, not a caller's input — but a
    // malformed one must still not reach another tenant's bucket, so it gets
    // the same two guards `file+/preview+/$bucket.$.tsx` applies. `companyId`
    // has to be a whole path segment: a loose `includes` would let
    // `<otherCo>/…/<thisCo>.pdf` through.
    const key = storagePath.replace(/^\/file\/preview\/private\//, "");
    const owned =
      key.startsWith(`${user.companyId}/`) ||
      key.includes(`/${user.companyId}/`);
    if (isUnsafeStoragePath(key) || !owned) {
      log.warn("Refused an inspection drawing path outside its company", {
        companyId: user.companyId,
        inspectionId,
        documentId
      });
      throw new ApiError(404, "not_found", "This lot has no drawing");
    }

    const file = await storage(serviceRole)
      .company(user.companyId)
      .download(key);
    if (file.error || !file.data) {
      if (await isStorageNotFound(file.error)) {
        throw new ApiError(404, "not_found", "The drawing file is missing");
      }
      log.error("Could not read an inspection drawing", {
        companyId: user.companyId,
        inspectionId,
        error: file.error
      });
      throw new ApiError(500, "internal", "Could not read the drawing");
    }

    let png: Uint8Array;
    try {
      png = await renderPdfPageAsPng(await file.data.arrayBuffer(), page, {
        scale
      });
    } catch (error) {
      // A page past the end of the document is the ordinary case here: the
      // wire carries no page count, so a client finds the end by asking.
      log.warn("Could not render an inspection drawing page", {
        companyId: user.companyId,
        inspectionId,
        page,
        error
      });
      throw new ApiError(404, "not_found", "That page is not in the drawing");
    }

    return new Response(png as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        // A drawing revision is a new document row, so a rendered page is
        // immutable for as long as its id is. `private` because it is one
        // company's engineering drawing and must not land in a shared cache.
        "Cache-Control": "private, max-age=86400, immutable"
      }
    });
  }
);
