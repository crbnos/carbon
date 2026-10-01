// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createCookieSessionStorage } from "react-router";

const MES_PEOPLE_OVERRIDE_KEY = "mes-people-override";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: MES_PEOPLE_OVERRIDE_KEY,
    path: "/",
    secure: false
  }
});

/**
 * The date (YYYY-MM-DD) for which the operator dismissed the people-assignment
 * station default this session; undefined when never dismissed.
 */
export async function getPeopleOverride(
  request: Request
): Promise<string | undefined> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  return session.get(MES_PEOPLE_OVERRIDE_KEY) as string | undefined;
}

export async function setPeopleOverride(request: Request, date: string) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  session.set(MES_PEOPLE_OVERRIDE_KEY, date);
  return sessionStorage.commitSession(session);
}
