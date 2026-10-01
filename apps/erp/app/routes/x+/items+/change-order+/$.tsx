// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Legacy URL shim: /x/items/change-order/* → /x/items/change-notice/*
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  throw redirect(
    `${url.pathname.replace(
      "/items/change-order",
      "/items/change-notice"
    )}${url.search}`,
    301
  );
}
