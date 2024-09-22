import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import {
  commitAuthSession,
  refreshAuthSession,
} from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.authenticatedRoot);
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const authSession = await refreshAuthSession(request);

  return json(
    { success: true },
    {
      headers: {
        "Set-Cookie": await commitAuthSession(request, {
          authSession,
        }),
      },
    }
  );
}

export function ErrorBoundary() {
  const navigate = useNavigate();
  navigate(path.to.authenticatedRoot);
  return null;
}
