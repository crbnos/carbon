// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  DocumentEdit,
  DocumentEditType
} from "@carbon/documents/template";
import { documentEditSchema } from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("lib", "document-edit");

/**
 * The saved edits to one document (`documentEdit`), or null when it has none.
 * Every renderer of that document applies them, so the live PDF, the PDF saved
 * at send time and the email attachment print the same words.
 */
export async function getDocumentEdit(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    documentType: DocumentEditType;
    documentId: string;
  }
): Promise<DocumentEdit | null> {
  const { data, error } = await client
    .from("documentEdit")
    .select("blocks, settings")
    .eq("companyId", args.companyId)
    .eq("documentType", args.documentType)
    .eq("documentId", args.documentId)
    .maybeSingle();
  if (error) {
    logger.error("Failed to read the document's edits", { ...args, error });
    return null;
  }
  if (!data) return null;
  const parsed = documentEditSchema.safeParse(data);
  if (!parsed.success) {
    logger.error("The document's stored edits do not parse", {
      ...args,
      error: parsed.error
    });
    return null;
  }
  return parsed.data;
}
