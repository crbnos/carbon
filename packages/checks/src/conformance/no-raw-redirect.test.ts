// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noRawRedirect } from "./no-raw-redirect";

const scan = (contents: string) =>
  noRawRedirect.scan("apps/erp/app/routes/x.tsx", contents);

describe("noRawRedirect", () => {
  it("flags redirect imported from react-router, on one line or several", () => {
    expect(
      scan(`import { data, redirect } from "react-router";
import {
  type LoaderFunctionArgs,
  redirectDocument
} from "react-router";`).map((v) => v.line)
    ).toEqual([1, 2]);
  });

  it("accepts the @carbon/utils redirect and other react-router imports", () => {
    expect(
      scan(`import { redirect, redirectExternal } from "@carbon/utils";
import { data, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";`)
    ).toEqual([]);
  });
});
