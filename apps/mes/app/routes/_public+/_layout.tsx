import { Outlet } from "@remix-run/react";
import { BsHexagonFill } from "react-icons/bs";

import { Heading } from "@carbon/react";

export default function PublicRoute() {
  return (
    <div className="container relative h-full flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <BsHexagonFill className="w-6 h-6 mr-2" />
          CarbonOS
        </div>

        <div className="relative z-20 mt-auto">
          <blockquote className="space-y-2">
            <Heading size="display" className="text-white/90">
              Let's build something
              <span className="inline-block">
                <span className="loading-dot">.</span>
                <span className="loading-dot">.</span>
                <span className="loading-dot">.</span>
              </span>
            </Heading>
          </blockquote>
        </div>
      </div>
      <div className="lg:p-8">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
