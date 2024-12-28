import { Outlet } from "@remix-run/react";

export const config = {
  runtime: "nodejs",
};

export default function SchedulingRoute() {
  return <Outlet />;
}
