import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { cn } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

// Public, self-contained error page for a failed download — deliberately NOT
// under the _public+ login layout (no marketing panel; this isn't a sign-in
// flow). Just the logo and the reason. Renders under root.tsx's LocaleProvider,
// so Lingui macros resolve. All copy is wrapped for extraction.
const REASONS = {
  invalid: msg`This download link is invalid or has been tampered with.`,
  unavailable: msg`This file is no longer available, or you don't have permission to download it.`
} as const;

type Reason = keyof typeof REASONS;

export async function loader({ request }: LoaderFunctionArgs) {
  const reason = new URL(request.url).searchParams.get("reason");
  return {
    reason: (reason === "invalid" ? "invalid" : "unavailable") as Reason
  };
}

export default function DownloadErrorRoute() {
  const { reason } = useLoaderData<typeof loader>();
  const { i18n } = useLingui();

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <header className="p-6">
        <img
          src="/carbon-word-light.svg"
          alt="Carbon"
          className={cn(
            "max-w-[160px] dark:hidden",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        />
        <img
          src="/carbon-word-dark.svg"
          alt="Carbon"
          className={cn(
            "max-w-[160px] hidden dark:block",
            CONTROLLED_ENVIRONMENT && "grayscale"
          )}
        />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            <Trans>Can't download this file</Trans>
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            {i18n._(REASONS[reason])}
          </p>
        </div>
      </main>
    </div>
  );
}
