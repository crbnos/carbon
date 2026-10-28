// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/env";
import {
  PrioritySetPanel,
  PrioritySetProvider,
  PrioritySetQuestions,
  usePrioritySet
} from "@carbon/implementation-hub/ui";
import {
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  toast
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCopy, LuDownload } from "react-icons/lu";
import { DocumentPage, DocumentPageHeader } from "~/components/DocumentPage";
import { useUser } from "~/hooks";
import { buildAgentSetupMessage } from "~/utils/agent-setup";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";

// The priority set questionnaire, laid out as a document page: the questions
// in the column, the company's live set in the side panel. Its data is the
// hub's field values, which the get-started layout already loads and keeps
// live; answers go through the same /state action as every other hub write.
export const handle: Handle = {
  breadcrumb: msg`Priority Set`,
  to: path.to.implementationPrioritySet
};

export default function PrioritySetRoute() {
  const { company } = useUser();
  return (
    <PrioritySetProvider companyName={company.name}>
      <PrioritySetPage />
    </PrioritySetProvider>
  );
}

function PrioritySetPage() {
  const { t } = useLingui();
  return (
    <DocumentPage
      header={<PrioritySetHeader />}
      sidebar={<PrioritySetPanel />}
      sidebarLabels={{
        title: t`Your Carbon setup`,
        show: t`Show your Carbon setup`,
        hide: t`Hide your Carbon setup`
      }}
    >
      {/* Under the AI assistant question, so answering it moves nothing
          above the cursor. */}
      <PrioritySetQuestions after={{ aiAssistant: <AssistantSetup /> }} />
    </DocumentPage>
  );
}

// Shown once the company wants an AI assistant to enter data during
// onboarding: the home page's setup prompt, which connects the assistant to
// this instance's MCP server. The questionnaire itself stays on this page.
function AssistantSetup() {
  const { t } = useLingui();
  const { state } = usePrioritySet();
  if (!(state.answers.aiAssistant ?? []).includes("onboarding")) return null;

  const copy = () =>
    copyToClipboard(buildAgentSetupMessage(getAppUrl()), () => {
      toast.success(t`Copied the prompt to your clipboard`);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm leading-snug line-clamp-none">
          <Trans>Connect your AI assistant to Carbon</Trans>
        </CardTitle>
        <CardDescription className="text-pretty">
          <Trans>
            Paste this prompt into your assistant. It connects the assistant to
            Carbon, so it can enter data for you.
          </Trans>
        </CardDescription>
        <CardAction>
          <Button variant="secondary" leftIcon={<LuCopy />} onClick={copy}>
            <Trans>Copy Prompt</Trans>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

function PrioritySetHeader() {
  const { t } = useLingui();
  const { progress, saving, copyMarkdown, downloadMarkdown } = usePrioritySet();
  const { answered, total } = progress;
  return (
    <DocumentPageHeader
      title={t`Priority Set`}
      copyable={false}
      meta={[
        <span key="answered">{t`${answered} of ${total} answered`}</span>,
        saving ? (
          <span key="saving">
            <Trans>Saving…</Trans>
          </span>
        ) : null
      ]}
      actions={
        <>
          <Button
            variant="secondary"
            leftIcon={<LuCopy />}
            onClick={copyMarkdown}
          >
            <Trans>Copy as Markdown</Trans>
          </Button>
          <Button
            variant="secondary"
            leftIcon={<LuDownload />}
            onClick={downloadMarkdown}
          >
            <Trans>Download</Trans>
          </Button>
        </>
      }
    />
  );
}
