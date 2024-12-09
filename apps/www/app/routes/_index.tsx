import { LuMoveUpRight, LuSend } from "react-icons/lu";

import { getAppUrl } from "@carbon/auth";
import { Input, Submit, ValidatedForm } from "@carbon/form";
import { toast } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import { z } from "zod";

const emailValidator = z.object({
  email: z.string().email(),
});

export default function Route() {
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.success) {
      toast.success("Email submitted");
    } else {
      toast.error(fetcher.data.message ?? "Failed to submit email");
    }
  }, [fetcher.data]);

  return (
    <>
      <header className="flex select-none items-center bg-background pl-5 pr-4 border-b h-[52px] border-transparent">
        <div className="flex items-center gap-2 z-logo text-foreground cursor-pointer"></div>
      </header>

      <div className="relative flex h-full w-full items-start justify-center overflow-hidden bg-background">
        <a
          id="announcement"
          href="https://app.carbonos.dev"
          className="fixed top-10 left-1/2 -translate-x-1/2 group items-center border border-input rounded-full px-4 py-1.5 flex mb-4.5 text-xs hover:bg-alpha-gray-2 dark:hover:bg-background transition-theme"
          target="_blank"
          rel="noreferrer"
        >
          CarbonOS
          <span className="hidden md:inline-flex">: now in private beta</span>
          <LuMoveUpRight className="ml-2" />
          <span className="absolute -top-px left-[2.5rem] h-px w-[calc(100%-5rem)] bg-gradient-to-r from-emerald-600/0 via-emerald-600/80 to-emerald-600/0 opacity-0 group-hover:opacity-100 transition-opacity transition-theme"></span>
          <span className="absolute -top-px left-1/2 -translate-x-1/2 h-px w-[60px] bg-gradient-to-r from-emerald-300/0 via-emerald-300/50 to-emerald-300/0 mix-blend-overlay opacity-0 group-hover:opacity-100 transition-opacity transition-theme"></span>
        </a>

        <div className="ray" data-theme="dark">
          <div className="light-ray ray-one"></div>
          <div className="light-ray ray-two"></div>
          <div className="light-ray ray-three"></div>
          <div className="light-ray ray-four"></div>
          <div className="light-ray ray-five"></div>
        </div>

        <div
          id="intro"
          className="flex flex-col pt-[24dvh] mx-auto w-container text-center"
        >
          <img
            src="https://app.carbonos.dev/carbon-logo-light.png"
            alt="CarbonOS"
            className="max-w-64 w-[25dvh] mx-auto"
          />

          <ValidatedForm
            action={`${getAppUrl()}/api/subscribe`}
            validator={emailValidator}
            fetcher={fetcher}
            method="post"
            className="flex flex-col gap-3 my-8"
          >
            <Input name="email" label="Email" />
            <Submit
              className="h-10"
              variant="secondary"
              leftIcon={<LuSend />}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              Get Updates
            </Submit>
          </ValidatedForm>
        </div>
      </div>
    </>
  );
}
