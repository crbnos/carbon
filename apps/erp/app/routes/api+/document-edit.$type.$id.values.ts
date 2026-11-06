// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { collectValues } from "@carbon/documents/template";
import {
  getCompanyTemplate,
  getDocumentEdit
} from "@carbon/lib/document-edit.server";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  renderDocumentWithEdit,
  requireDocumentEditRecord
} from "~/modules/settings/document-edit.pdf";

const logger = getLogger("erp", "document-edit", "values");

/**
 * The record's own values, for the pencils and preview clicks of "Edit document". Only a render
 * holds them, because a table row's variables are built as it prints. It
 * prints every block, so a block the user shows later already has its values,
 * and none of the changed values, so the section can tell what changed.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyGroupId, key } = await requireDocumentEditRecord(
    request,
    params
  );
  const { collector, collected } = collectValues();

  try {
    const [template, saved] = await Promise.all([
      getCompanyTemplate(client, key),
      getDocumentEdit(client, key)
    ]);
    await renderDocumentWithEdit(client, {
      documentType: key.documentType,
      documentId: key.documentId,
      companyId: key.companyId,
      companyGroupId,
      locale: getPreferenceHeaders(request).locale,
      edit: {
        blocks: Object.fromEntries(
          template.blocks.map((block) => [
            block.id,
            { ...saved?.blocks[block.id], visible: true }
          ])
        ),
        settings: { ...saved?.settings, valueEdits: undefined }
      },
      valueCollector: collector
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    logger.error("Failed to read the document's values", { ...key, error });
    throw new Response("The document's values could not be read.", {
      status: 500
    });
  }

  return data({ data: collected });
}
