import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");

  throw redirect(path.to.jobDetails(jobId));
}
