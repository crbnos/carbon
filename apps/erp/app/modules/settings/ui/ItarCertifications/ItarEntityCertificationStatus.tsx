import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { now, parseAbsolute } from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import { LuBuilding2, LuCircleAlert, LuCircleCheck } from "react-icons/lu";

export type ItarEntityCertificationRecord = {
  userId: string | null;
  fullLegalName: string | null;
  title: string | null;
  complianceContact: string | null;
  docVersion: string | null;
  certifiedAt: string | null;
  expiresAt: string | null;
};

type ItarEntityCertificationStatusProps = {
  certification: ItarEntityCertificationRecord | null;
};

/**
 * Company-level half of the compliance report: whether a representative of this
 * company has accepted the Carbon GovCloud Rider. The table below it is
 * per-person (U.S.-Person attestations); this is a single fact about the entity,
 * so it reads as a status banner rather than a column repeated on every row.
 *
 * Pending is the normal state for a freshly provisioned tenant — Carbon staff
 * set the company up but cannot sign on its behalf, so it stays pending until
 * the company's own first admin accepts.
 */
const ItarEntityCertificationStatus = ({
  certification
}: ItarEntityCertificationStatusProps) => {
  const expiresAt = certification?.expiresAt ?? null;
  // Absolute-instant comparison against the same expiry the gate reads. Both
  // sides go through @internationalized/date rather than the JS Date the rest
  // of the repo avoids.
  const isExpired =
    expiresAt !== null &&
    parseAbsolute(expiresAt, "UTC").compare(now("UTC")) <= 0;
  const isCertified = certification !== null && !isExpired;

  return (
    <div className="w-full px-4 pt-4">
      <Alert variant={isCertified ? "success" : "warning"}>
        {isCertified ? <LuCircleCheck /> : <LuCircleAlert />}
        <AlertTitle>
          {isCertified ? (
            <Trans>Entity certification: Accepted</Trans>
          ) : isExpired ? (
            <Trans>Entity certification: Expired</Trans>
          ) : (
            <Trans>Entity certification: Pending</Trans>
          )}
        </AlertTitle>
        <AlertDescription>
          {certification ? (
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <LuBuilding2 className="size-3.5 shrink-0" />
                {certification.fullLegalName}
                {certification.title ? `, ${certification.title}` : null}
              </span>
              {certification.certifiedAt ? (
                <span>
                  {/* Whole phrases, not "Accepted" + a date — the adjective
                      agrees with "certification" in several locales. */}
                  <Trans>
                    Accepted {formatDate(certification.certifiedAt)}
                  </Trans>
                </span>
              ) : null}
              {certification.docVersion ? (
                <span>
                  <Trans>Rider v{certification.docVersion}</Trans>
                </span>
              ) : null}
              {expiresAt ? (
                <span>
                  {isExpired ? (
                    <Trans>Expired {formatDate(expiresAt)}</Trans>
                  ) : (
                    <Trans>Expires {formatDate(expiresAt)}</Trans>
                  )}
                </span>
              ) : null}
            </span>
          ) : (
            <Trans>
              No representative of this company has accepted the Carbon GovCloud
              Rider yet. An administrator at this company must accept it before
              anyone can access Carbon — Carbon staff cannot accept it on your
              behalf.
            </Trans>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
};

ItarEntityCertificationStatus.displayName = "ItarEntityCertificationStatus";
export default ItarEntityCertificationStatus;
