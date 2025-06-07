import { Outlet } from "@remix-run/react";

import { Heading } from "@carbon/react";

export default function PublicRoute() {
  return (
    <div className="container relative h-full flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 lg:flex dark:border-r dark:bg-zinc-900 bg:zinc-100">
        <img
          src="/carbon-word-light.svg"
          alt="Carbon Logo"
          className="max-w-[240px] mb-3 dark:hidden z-50"
        />
        <img
          src="/carbon-word-dark.svg"
          alt="Carbon Logo"
          className="max-w-[240px] mb-3 dark:block hidden z-50"
        />

        <div className="relative z-20 mt-auto">
          <blockquote className="space-y-2">
            <Heading size="display" className="text-foreground">
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
