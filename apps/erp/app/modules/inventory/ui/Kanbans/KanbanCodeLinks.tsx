// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  copyToClipboard,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createContext, useContext, useState } from "react";
import { LuCheck, LuLink, LuQrCode, LuTag } from "react-icons/lu";
import type { kanbanOutputTypes } from "~/modules/settings/settings.models";
import { path } from "~/utils/path";
import type { KanbanSummary } from "../../types";

export type KanbanOutput = (typeof kanbanOutputTypes)[number];

type KanbanQrCodeAction = "order" | "start" | "complete";

// One QR code popover open at a time across the whole table. Each hover card
// closes only after its own delay, so moving across the Create / Start /
// Complete badges used to leave several popovers open on top of each other.
const OpenQrCodeContext = createContext<
  [string | null, Dispatch<SetStateAction<string | null>>] | null
>(null);

/** Holds the one QR code popover open across every kanban it wraps. */
export function KanbanQrCodeProvider({ children }: { children: ReactNode }) {
  const openQrCode = useState<string | null>(null);
  return (
    <OpenQrCodeContext.Provider value={openQrCode}>
      {children}
    </OpenQrCodeContext.Provider>
  );
}

function KanbanQrCodeHoverCard({
  kanbanId,
  action,
  label,
  tooltip
}: {
  kanbanId: string;
  action: KanbanQrCodeAction;
  label: ReactNode;
  tooltip: ReactNode;
}) {
  const openQrCode = useContext(OpenQrCodeContext);
  const key = `${kanbanId}:${action}`;
  const isOpen = openQrCode ? openQrCode[0] === key : undefined;

  return (
    <HoverCard
      open={isOpen}
      onOpenChange={(open) =>
        openQrCode?.[1]((current) =>
          open ? key : current === key ? null : current
        )
      }
    >
      <Tooltip>
        <TooltipTrigger>
          <HoverCardTrigger>
            <Badge
              variant="outline"
              className="flex flex-row items-center gap-1 cursor-pointer"
            >
              <LuQrCode />
              {label}
            </Badge>
          </HoverCardTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      <HoverCardContent
        align="center"
        className="size-[236px] overflow-hidden z-[100] bg-white p-4"
      >
        <iframe
          seamless
          title={"Kanban QR Code"}
          width="198"
          height="198"
          src={path.to.file.kanbanQrCode(kanbanId, action)}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

/** The kanban's Create card, and Start / Complete for a Make kanban, as the
 *  company's kanban output: label PDFs, QR codes or links. */
export function KanbanCodeLinks({
  kanban,
  kanbanOutput
}: {
  kanban: Pick<KanbanSummary, "id" | "replenishmentSystem">;
  kanbanOutput: KanbanOutput;
}) {
  const { t } = useLingui();
  const isMake = kanban.replenishmentSystem === "Make";

  if (kanbanOutput === "label") {
    return (
      <HStack>
        <LabelBadge
          kanbanId={kanban.id}
          action="order"
          label={<Trans>Create</Trans>}
          tooltip={t`Label to create a ${getKanbanCreateNoun(kanban.replenishmentSystem)} for this kanban`}
        />
        {isMake && (
          <>
            <LabelBadge
              kanbanId={kanban.id}
              action="start"
              label={<Trans>Start</Trans>}
              tooltip={
                <Trans>Label to start the next operation for this kanban</Trans>
              }
            />
            <LabelBadge
              kanbanId={kanban.id}
              action="complete"
              label={<Trans>Complete</Trans>}
              tooltip={
                <Trans>
                  Label to complete the current operation for this kanban
                </Trans>
              }
            />
          </>
        )}
      </HStack>
    );
  }

  if (kanbanOutput === "qrcode") {
    return (
      <HStack>
        <KanbanQrCodeHoverCard
          kanbanId={kanban.id}
          action="order"
          label={<Trans>Create</Trans>}
          tooltip={t`QR Code to create a ${getKanbanCreateNoun(kanban.replenishmentSystem)} for this kanban`}
        />
        {isMake && (
          <>
            <KanbanQrCodeHoverCard
              kanbanId={kanban.id}
              action="start"
              label={<Trans>Start</Trans>}
              tooltip={
                <Trans>
                  QR Code to start the next operation for this kanban
                </Trans>
              }
            />
            <KanbanQrCodeHoverCard
              kanbanId={kanban.id}
              action="complete"
              label={<Trans>Complete</Trans>}
              tooltip={
                <Trans>
                  QR Code to complete the current operation for this kanban
                </Trans>
              }
            />
          </>
        )}
      </HStack>
    );
  }

  return (
    <HStack>
      <CopyBadge
        text="Create"
        url={path.to.api.kanban(kanban.id)}
        tooltip={`Copy link to create a ${getKanbanCreateNoun(kanban.replenishmentSystem)} for this kanban`}
      />
      {isMake && (
        <>
          <CopyBadge
            text="Start"
            url={path.to.api.kanbanStart(kanban.id)}
            tooltip={`Copy link to start the next operation for this kanban`}
          />
          <CopyBadge
            text="Complete"
            url={path.to.api.kanbanComplete(kanban.id)}
            tooltip={`Copy link to complete the current operation for this kanban`}
          />
        </>
      )}
    </HStack>
  );
}

function LabelBadge({
  kanbanId,
  action,
  label,
  tooltip
}: {
  kanbanId: string;
  action: KanbanQrCodeAction;
  label: ReactNode;
  tooltip: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <a
          href={path.to.file.kanbanLabelsPdf([kanbanId], action)}
          target="_blank"
          rel="noreferrer"
        >
          <Badge variant="outline" className="flex flex-row items-center gap-1">
            <LuTag />
            {label}
          </Badge>
        </a>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// The document a "create" scan produces: a Job for Make, a Transfer for
// Transfer, otherwise a purchase Order.
function getKanbanCreateNoun(replenishmentSystem: string | null) {
  if (replenishmentSystem === "Make") return "Job";
  if (replenishmentSystem === "Transfer") return "Transfer";
  return "Order";
}

function CopyBadge({
  text,
  url,
  tooltip
}: {
  text: string;
  url: string;
  tooltip: string;
}) {
  const { t } = useLingui();
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(window.location.origin + url);
    setIsCopied(true);
    toast.success(t`Copied link to clipboard`);
    setTimeout(() => setIsCopied(false), 1500);
  };

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge
          variant="outline"
          className="flex flex-row items-center gap-1 cursor-pointer"
          onClick={handleCopy}
        >
          {isCopied ? <LuCheck className="text-emerald-500" /> : <LuLink />}
          {text}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
