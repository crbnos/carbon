import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");
  throw redirect(path.to.personDetails(personId));
}
