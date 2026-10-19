// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { approvalDecisionValidator } from "@carbon/ee/approvals";
import { getDocumentApprovalState } from "@carbon/ee/approvals/document.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getQualityDocument,
  getQualityDocumentVersions
} from "~/modules/quality/quality.service";
import QualityDocumentEditor from "~/modules/quality/ui/Documents/QualityDocumentEditor";
import QualityDocumentHeader from "~/modules/quality/ui/Documents/QualityDocumentHeader";
import QualityDocumentProperties from "~/modules/quality/ui/Documents/QualityDocumentProperties";
import { getTagsList } from "~/modules/shared/shared.service";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "id");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Policy & Procedure`, to: path.to.qualityDocuments },
    (data) => data?.document?.name
  ),
  module: "quality"
};

// Approving makes the document Active; rejecting leaves it in Draft.
export async function action(args: ActionFunctionArgs) {
  const input = await validator(approvalDecisionValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.quality.decideQualityDocumentApproval({
    ...input.data,
    qualityDocumentId: id
  });
  return respond(args.request, result).redirect(path.to.qualityDocument(id), {
    message: `Approval request ${input.data.decision.toLowerCase()} successfully`
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  // Kick off approval in parallel — it only needs document.status, so we chain
  // off the document fetch rather than waiting for Promise.all to settle.
  // Approval only gates Draft / Archived → Active.
  const documentPromise = getQualityDocument(client, id);
  const [document, tags, approval] = await Promise.all([
    documentPromise,
    getTagsList(client, companyId, "qualityDocument"),
    documentPromise.then((d) =>
      d.data?.status === "Draft" || d.data?.status === "Archived"
        ? getDocumentApprovalState(getCarbonServiceRole(), {
            documentType: "qualityDocument",
            documentId: id,
            companyId,
            userId
          })
        : null
    )
  ]);

  if (document.error) {
    throw redirect(
      path.to.qualityDocuments,
      await flash(request, error(document.error, "Failed to load document"))
    );
  }

  // bypassRls makes `client` the service role, so the URL id is only proven
  // to exist — not to be this company's.
  if (document.data.companyId !== companyId) {
    logger.error("Quality document is not in the caller's company", {
      companyId,
      documentId: id
    });
    throw redirect(path.to.qualityDocuments);
  }

  return {
    document: document.data,
    versions: getQualityDocumentVersions(client, document.data, companyId),
    tags: tags.data ?? [],
    approval
  };
}

export default function QualityDocumentRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { document } = useLoaderData<typeof loader>();

  return (
    <PanelProvider key={`${id}-${document.version}`}>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <QualityDocumentHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <QualityDocumentEditor />
                  <RecordOutlet />
                </div>
              }
              properties={
                <QualityDocumentProperties
                  key={`properties-${id}-${document.version}`}
                />
              }
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
