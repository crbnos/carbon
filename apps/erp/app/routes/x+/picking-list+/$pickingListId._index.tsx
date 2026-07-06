import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { pickingListId } = params;
  if (!pickingListId) throw new Error("Could not find pickingListId");
  throw redirect(path.to.pickingListDetails(pickingListId));
}
