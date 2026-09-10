import { assertIsPost } from "@carbon/auth";
import { destroyAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  return destroyAuthSession(request, { revoke: true });
}

export async function loader() {
  throw redirect(path.to.root);
}
