import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";

import { destroyAuthSession } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  return destroyAuthSession(request);
}

export async function loader() {
  throw redirect(path.to.root);
}
