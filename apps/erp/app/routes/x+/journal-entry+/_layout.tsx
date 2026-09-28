import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Journal Entry" }];
};

export const handle: Handle = {
  breadcrumb: msg`Accounting`,
  to: path.to.accountingJournals,
  module: "accounting"
};

export default function JournalEntryLayout() {
  return <Outlet />;
}
