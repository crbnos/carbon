import { createCookieSessionStorage, redirect } from "@vercel/remix";
import { path } from "~/utils/path";

const MES_FILTERS_KEY = "mes-filters";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: MES_FILTERS_KEY,
    path: "/",
  },
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

export async function destroySession(request: Request) {
  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );

  return redirect(path.to.root, {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}
