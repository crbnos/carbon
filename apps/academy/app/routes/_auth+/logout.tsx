import { assertIsPost } from "@carbon/auth";
import { destroyAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";

import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  return destroyAuthSession(request);
}

export async function loader() {
  throw redirect(path.to.root);
}
