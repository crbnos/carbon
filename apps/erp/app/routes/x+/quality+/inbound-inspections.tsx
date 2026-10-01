// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// The Inbound Inspections submodule was renamed to Inspections.
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  throw redirect(`${path.to.inspections}${search}`);
}
