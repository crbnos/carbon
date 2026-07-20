import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  throw redirect(path.to.changeOrderDetails(id));
}
