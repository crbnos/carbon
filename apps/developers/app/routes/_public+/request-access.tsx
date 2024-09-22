import { Button } from "@carbon/react";
import type { MetaFunction } from "@vercel/remix";
import { VERCEL_URL } from "~/config/env";
import { removeSubdomain } from "~/utils/path";

export const APP_URL = VERCEL_URL?.includes("localhost")
  ? "http://localhost:3000"
  : `https://app.${removeSubdomain(VERCEL_URL)}`;

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon Developers | Request Access",
    },
  ];
};

export default function RequestAccessRoute() {
  return (
    <>
      <div className="flex flex-col items-center justify-center">
        <img
          src="/carbon-logo-dark.png"
          alt="Carbon Logo"
          className="block dark:hidden max-w-[100px] mb-3"
        />
        <img
          src="/carbon-logo-light.png"
          alt="Carbon Logo"
          className="hidden dark:block max-w-[100px] mb-3"
        />
        <h3 className="font-mono font-bold leading-loose uppercase text-xl">
          Developers
        </h3>
      </div>
      <div className="rounded-lg bg-card flex flex-col gap-4 border border-border shadow-lg p-8 w-[380px]">
        <p>
          Request access to the developer portal by emailing rob@carbonos.dev
        </p>
        <Button size="lg" asChild>
          <a href={APP_URL}>Return to App</a>
        </Button>
      </div>
    </>
  );
}
