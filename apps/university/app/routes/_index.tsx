import { redirect, type LoaderFunctionArgs } from "@vercel/remix";
import { sections } from "~/config";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(path.to.course(sections[0].id, sections[0].courses[0].id));
}

export default function IndexRoute() {
  return null;
}
