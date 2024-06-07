import { VStack } from "@carbon/react";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Routing",
  to: path.to.routings,
};

export default function PartsRoutingRoute() {
  return <VStack spacing={0} className="h-full"></VStack>;
}
