// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { storage } from "@carbon/files";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import RecordDocuments from "~/components/RecordDocuments";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Missing supplierId");

  const result = await storage(client)
    .company(companyId)
    .list(`${companyId}/supplier/${supplierId}`);

  return {
    supplierId,
    files: result.data ?? []
  };
}

export default function SupplierDocumentsRoute() {
  const { supplierId, files } = useLoaderData<typeof loader>();

  return (
    <RecordDocuments
      files={files}
      id={supplierId}
      bucketPrefix="supplier"
      sourceDocument="Supplier"
      module="purchasing"
    />
  );
}
