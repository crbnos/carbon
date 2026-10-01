// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, isAuthProviderEnabled } from "@carbon/auth";
import { getPasskeyAuthenticationOptions } from "@carbon/auth/passkey.server";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  if (!isAuthProviderEnabled("passkey")) {
    return data(error(null, "Passkeys are disabled"), { status: 404 });
  }

  const challengeId = nanoid();
  const options = await getPasskeyAuthenticationOptions(challengeId);

  return data({ ...options, challengeId });
}
