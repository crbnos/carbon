import type { IntegrationID } from "@carbon/ee";
import { getIntegrationConfigById } from "@carbon/ee";
import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

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
 * The logo is the `logo` field on the integration config
 * (`packages/ee/src/types.ts`), looked up with `getIntegrationConfigById`. That
 * chain is already in the ERP client bundle (the integrations settings page
 * imports the same barrel), so there is no server-only module here.
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

  const badge = config ? (
    <span className="inline-flex items-center gap-1.5">
      {/*
        `shrink-0` is load-bearing: the logo is a flex item with no explicit
        width (it sizes from its viewBox aspect), so flex-shrink squeezed the
        Ramp wordmark from 75px to 11px while keeping its height — and
        preserveAspectRatio then letterboxed it down to an illegible smudge.
      */}
      <config.logo className="shrink-0" style={{ height: "0.875rem" }} />
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
