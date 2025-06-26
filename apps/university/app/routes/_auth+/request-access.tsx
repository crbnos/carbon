import { getAppUrl } from "@carbon/auth";
import { Button } from "@carbon/react";
import { SUPPORT_EMAIL } from "@carbon/utils";
import type { MetaFunction } from "@vercel/remix";

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
          src="/carbon-logo-mark.svg"
          alt="Carbon Logo"
          className="w-36 mb-3"
        />

        <h3 className="font-mono font-bold leading-loose uppercase text-xl">
          Developers
        </h3>
      </div>
      <div className="rounded-lg bg-card flex flex-col gap-4 border border-border shadow-lg p-8 w-[380px]">
        <p>
          Request access to the developer portal by emailing {SUPPORT_EMAIL}
        </p>
        <Button size="lg" asChild>
          <a href={getAppUrl()}>Return to App</a>
        </Button>
      </div>
    </>
  );
}
