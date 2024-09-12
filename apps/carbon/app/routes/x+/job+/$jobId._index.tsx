import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { jobId } = params;
  if (!jobId) throw new Error("Could not find jobId");
  throw redirect(path.to.jobDetails(jobId));
}
