// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Inspection plans moved from Production to Quality; keep old links working.
export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(
    `${path.to.inspectionDocuments}${new URL(request.url).search}`
  );
}
