import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader() {
  throw redirect(`${path.to.analyticsReport("revenue")}?rows=et:Customer`);
}
