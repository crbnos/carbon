import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { LearnCertificatePDF } from "@carbon/documents/pdf";
import { generateQRCode } from "@carbon/documents/qr";
import { getLogger } from "@carbon/logger";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getLearnCertificateById } from "~/modules/resources";
import { getCompany } from "~/modules/settings";
import { ERP_URL, path } from "~/utils/path";

const logger = getLogger("erp", "learn-certificate-pdf");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const { id } = params;
  if (!id) return new Response("Missing certificate id", { status: 400 });

  const serviceRole = await getCarbonServiceRole();
  const certificate = await getLearnCertificateById(serviceRole, id, companyId);

  if (certificate.error || !certificate.data) {
    return new Response("Certificate not found", { status: 404 });
  }

  // A learner may print their own; anyone else needs the resources permission,
  // which requirePermissions enforces by redirecting on denial.
  if (certificate.data.userId !== userId) {
    await requirePermissions(request, { view: "resources" });
  }

  const [company, learner] = await Promise.all([
    getCompany(client, companyId),
    serviceRole
      .from("user")
      .select("fullName")
      .eq("id", certificate.data.userId)
      .single()
  ]);

  if (company.error) {
    logger.error(company.error);
    throw new Error("Failed to load company");
  }

  const verifyUrl = `${ERP_URL}${path.to.learnCertificateVerify(
    certificate.data.verificationCode
  )}`;

  // Resolve the QR to a data URL BEFORE render — react-pdf will accept a
  // promise, but the house rule is that all async work finishes first.
  const qrDataUrl = await generateQRCode(verifyUrl, 1.2);

  const now = new Date().toISOString();
  const status = certificate.data.revokedAt
    ? "Revoked"
    : certificate.data.expiresAt < now
      ? "Expired"
      : "Active";

  const stream = await renderToStream(
    <LearnCertificatePDF
      companyName={company.data.name}
      learnerName={learner.data?.fullName ?? "—"}
      trackTitle={certificate.data.trackTitle}
      issuedAt={certificate.data.issuedAt}
      expiresAt={certificate.data.expiresAt}
      verificationCode={certificate.data.verificationCode}
      verifyUrl={verifyUrl}
      qrDataUrl={qrDataUrl}
      contentVersion={certificate.data.contentVersion}
      examScorePercent={`${Math.round(Number(certificate.data.examScore) * 100)}%`}
      challengeCount={certificate.data.challengeSlugs?.length ?? 0}
      status={status}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${certificate.data.trackTitle} Certificate.pdf"`
  });

  return new Response(new Uint8Array(body), { status: 200, headers });
}
