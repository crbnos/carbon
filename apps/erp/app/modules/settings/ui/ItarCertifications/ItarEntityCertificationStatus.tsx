import { Alert, AlertDescription, AlertTitle } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();

  const expiresAt = certification?.expiresAt ?? null;
  const isExpired = expiresAt !== null && Date.parse(expiresAt) <= Date.now();
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
                  {t`Accepted`} {formatDate(certification.certifiedAt)}
                </span>
              ) : null}
              {certification.docVersion ? (
                <span>
                  {t`Rider`} v{certification.docVersion}
                </span>
              ) : null}
              {expiresAt ? (
                <span>
                  {isExpired ? t`Expired` : t`Expires`} {formatDate(expiresAt)}
                </span>
              ) : null}
            </span>
          ) : (
            <Trans>
              No representative of this company has accepted the Carbon GovCloud
              Rider yet. An administrator here must accept it before anyone can
              enter — Carbon staff cannot accept it on your behalf.
            </Trans>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
};

ItarEntityCertificationStatus.displayName = "ItarEntityCertificationStatus";
export default ItarEntityCertificationStatus;
