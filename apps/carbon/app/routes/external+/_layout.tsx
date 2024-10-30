import { Outlet } from "@remix-run/react";

export default function ExternalLayout() {
  return (
    <div className="w-screen min-h-screen flex flex-col items-center justify-center">
      <Outlet />
    </div>
  );
}
