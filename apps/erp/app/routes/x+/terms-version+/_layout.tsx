import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Terms & Conditions" }];
};

export const handle: Handle = {
  breadcrumb: msg`Terms & Conditions`,
  to: path.to.termsVersions,
  module: "settings"
};

export default function TermsVersionRoute() {
  return <Outlet />;
}
