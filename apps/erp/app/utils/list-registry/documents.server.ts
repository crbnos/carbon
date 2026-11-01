// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DOCUMENTS_PAGING,
  getDocuments,
  RECENT_DOCUMENTS_PAGING
} from "~/modules/documents/documents.service";
import type { ListDefinition } from "./index.server";

// `?q=` picks the view: `starred`, `recent`, `trash`, `my` or none (all).
// `getDocuments` does not filter on `createdBy`, so `my` lists every document.
// The `recent` flag comes from the list, not the URL, so the query's order
// always matches the list's paging.
function documentsQuery(recent: boolean) {
  return (
    ...[
      client,
      companyId,
      { params, limit, cursor, exactCount, sorts, filters }
    ]: Parameters<ListDefinition["query"]>
  ) => {
    const filter = params.get("q");
    return getDocuments(client, companyId, {
      search: params.get("search"),
      favorite: filter === "starred" ? true : undefined,
      recent: recent ? true : undefined,
      active: filter !== "trash",
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    });
  };
}

export const documentsList = {
  key: "documents",
  permission: { view: "documents" },
  ...DOCUMENTS_PAGING,
  query: documentsQuery(false)
} satisfies ListDefinition;

// The "Recent" view has its own default order, so it is its own list: the
// cursor must follow the order the query uses.
export const recentDocumentsList = {
  key: "recent-documents",
  permission: { view: "documents" },
  ...RECENT_DOCUMENTS_PAGING,
  query: documentsQuery(true)
} satisfies ListDefinition;

// The documents lists. Each entry follows `sales.server.ts`.
export const documentsLists: Record<string, ListDefinition> = {
  [documentsList.key]: documentsList,
  [recentDocumentsList.key]: recentDocumentsList
};
