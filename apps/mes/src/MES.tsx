import { Outlet } from "react-router-dom";

export function MES() {
  return (
    <>
      <div className="background">
        <div className="gradient" />
      </div>
      <div className="relative z-10">
        <div className="flex flex-col min-w-screen h-screen min-h-0">
          <Outlet />
        </div>
      </div>
    </>
  );
}
