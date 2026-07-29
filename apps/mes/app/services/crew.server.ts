import { createCookieSessionStorage } from "react-router";

const MES_CREW_OVERRIDE_KEY = "mes-crew-override";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: MES_CREW_OVERRIDE_KEY,
    path: "/",
    secure: false
  }
});

/**
 * The date (YYYY-MM-DD) for which the operator dismissed the crew-assignment
 * station default this session; undefined when never dismissed.
 */
export async function getCrewOverride(
  request: Request
): Promise<string | undefined> {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  return session.get(MES_CREW_OVERRIDE_KEY) as string | undefined;
}

export async function setCrewOverride(request: Request, date: string) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );
  session.set(MES_CREW_OVERRIDE_KEY, date);
  return sessionStorage.commitSession(session);
}
