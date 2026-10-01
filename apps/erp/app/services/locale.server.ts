// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DOMAIN, getCookieDomain } from "@carbon/auth";
import { localeCookieName, resolveLanguage } from "@carbon/locale";
import * as cookie from "cookie";

export function setLocale(locale: string) {
  const cookieOptions: cookie.SerializeOptions = {
    path: "/",
    maxAge: 31536000
  };

  const cookieDomain = getCookieDomain(DOMAIN);
  if (cookieDomain) cookieOptions.domain = cookieDomain;

  return cookie.serialize(
    localeCookieName,
    resolveLanguage(locale),
    cookieOptions
  );
}
