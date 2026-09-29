import type { IntegrationID } from "@carbon/ee";
import { getIntegrationConfigById } from "@carbon/ee";
import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";

/**
 * Ramp's square app icon, for the document SOURCE field only.
 *
 * Deliberately NOT the integration config's `logo` — that is the wide wordmark
 * the integrations card and settings form render, and it reads badly at badge
 * size next to the provider's name (a "ramp" wordmark beside the word "Ramp").
 * The icon is 1:1 and pairs with the name the way an app icon should.
 *
 * Brand colours are fixed (#E4F222 on black), not `currentColor`: recolouring a
 * logo per theme would misrepresent the mark, and it carries its own contrast.
 */
function RampSourceIcon(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Ramp</title>
      <rect width="100" height="100" rx="50" fill="#E4F222" />
      <path
        d="M81 76.0616V76.294L47.2323 76.3057V76.0616C52.1017 73.3118 55.4627 70.5108 58.4871 67.5837H72.3526L81 76.0616ZM72.6331 32.0857L64.074 23.6902H63.8253C63.8253 23.6902 63.9697 39.3364 49.599 53.5662C35.5368 67.4931 19 67.5246 19 67.5246V67.7686L27.7196 76.3097C27.7196 76.3097 44.0157 76.4708 58.4108 62.3512C72.7535 48.2788 72.6331 32.0857 72.6331 32.0857Z"
        fill="black"
      />
    </svg>
  );
}

/**
 * Per-provider marks for the SOURCE field. A provider with no entry here falls
 * back to its integration-config `logo`, so adding a spend provider still
 * renders something recognisable without touching this map.
 */
const SOURCE_ICONS: Record<
  string,
  (props: ComponentProps<"svg">) => ReactNode
> = {
  ramp: RampSourceIcon
};

type DocumentSourceBadgeProps = {
  /** The provider id stored on the document, e.g. `charge.integration`. */
  integration: string | null | undefined;
  /** The provider's own identifier, from externalIntegrationMapping.externalId. */
  externalId?: string | null;
  /** externalIntegrationMapping.metadata.deepLink, when the provider has one. */
  deepLink?: string | null;
  /** Renders the label above the badge. Defaults to "Source". */
  label?: ReactNode;
};

/**
 * The SOURCE field for a document that was imported from a spend/accounting
 * provider: the provider's logo, its name, and the provider's own identifier.
 *
 * Deliberately document-agnostic — it takes strings, not a reimbursement — so
 * the charge detail surface can render the identical field
 * (`.ai/specs/2026-09-23-editable-imported-spend-documents.md`).
 *
 * The mark comes from `SOURCE_ICONS` above when the provider has a square app
 * icon, else the integration config's wordmark `logo`. The NAME always comes
 * from the config (`getIntegrationConfigById`, `packages/ee/src/types.ts`).
 * That chain is already in the ERP client bundle (the integrations settings
 * page imports the same barrel), so there is no server-only module here.
 */
const DocumentSourceBadge = ({
  integration,
  externalId,
  deepLink,
  label
}: DocumentSourceBadgeProps) => {
  // A document with no provider has no SOURCE field at all.
  if (!integration) return null;

  const config = getIntegrationConfigById(integration as IntegrationID);
  const SourceIcon = SOURCE_ICONS[integration];

  const badge = config ? (
    <span className="inline-flex items-center gap-1.5">
      {/*
        `shrink-0` is load-bearing either way: the mark is a flex item with no
        explicit width (it sizes from its viewBox aspect), so flex-shrink
        squeezed the wordmark from 75px to 11px while keeping its height, and
        preserveAspectRatio then letterboxed it into an illegible smudge.
      */}
      {SourceIcon ? (
        <SourceIcon className="shrink-0 size-3.5" />
      ) : (
        <config.logo className="shrink-0" style={{ height: "0.875rem" }} />
      )}
      <span className="text-sm">{config.name}</span>
    </span>
  ) : (
    // An unrecognised provider id is data, not a crash — show the raw id rather
    // than an empty field.
    <Status color="blue">{integration}</Status>
  );

  const content = (
    <div className="flex flex-col gap-0.5">
      {badge}
      {externalId && (
        <span className="text-xs text-muted-foreground font-mono">
          {externalId}
        </span>
      )}
    </div>
  );

  return (
    // `shrink-0` so the provider's wordmark keeps its intrinsic width in the
    // header's flex row instead of being compressed into the adjacent action.
    <div className="flex flex-col gap-1 shrink-0">
      <span className="text-xs text-muted-foreground">
        {label ?? <Trans>Source</Trans>}
      </span>
      {deepLink ? (
        <a href={deepLink} target="_blank" rel="noreferrer">
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  );
};

export default DocumentSourceBadge;
