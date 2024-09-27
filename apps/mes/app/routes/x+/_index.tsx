import type { LoaderFunction } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export const loader: LoaderFunction = async () => {
  return redirect(path.to.jobs);
};
