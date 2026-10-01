// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createCookieSessionStorage } from "react-router";

const MES_FILTERS_KEY = "mes-filters";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: MES_FILTERS_KEY,
    path: "/",
    secure: false
  }
});

export async function getFilters(
  request: Request
): Promise<string | undefined> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  return session.get(MES_FILTERS_KEY) as string | undefined;
}

export async function setFilters(request: Request, filters: string) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  session.set(MES_FILTERS_KEY, filters);
  return sessionStorage.commitSession(session);
}

export async function removeFilters(request: Request) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  session.set(MES_FILTERS_KEY, undefined);
  return sessionStorage.commitSession(session);
}
