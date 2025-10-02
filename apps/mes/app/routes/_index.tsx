import { requireAuthSession } from "@carbon/auth/session.server";
import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  throw redirect(path.to.authenticatedRoot);
}

export default function IndexRoute() {
  return (
    <p>
      Oops. You shouldn't see this page. Eventually it will be a landing page.
    </p>
  );
}
