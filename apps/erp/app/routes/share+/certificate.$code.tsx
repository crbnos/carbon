import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Status,
  VStack
} from "@carbon/react";
import { formatDate, round } from "@carbon/utils";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getLearnCertificateByCode } from "~/modules/resources";

export const meta: MetaFunction = () => [
  { title: "Carbon | Verify certificate" }
];

/**
 * Public. No session, no company scope — the unguessable verification code IS
 * the credential, and a manager or a future employer has to be able to open it
 * without a Carbon login. Every "not valid" case returns the same NotFound
 * shape so the page never reveals whether a code exists.
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { code } = params;
  if (!code) return { state: "NotFound" as const, certificate: null };

  const serviceRole = await getCarbonServiceRole();
  const result = await getLearnCertificateByCode(serviceRole, code);

  if (result.error || !result.data) {
    return { state: "NotFound" as const, certificate: null };
  }

  const [company, learner] = await Promise.all([
    serviceRole
      .from("company")
      .select("name")
      .eq("id", result.data.companyId)
      .single(),
    serviceRole
      .from("user")
      .select("fullName")
      .eq("id", result.data.userId)
      .single()
  ]);

  const now = new Date().toISOString();
  const state = result.data.revokedAt
    ? ("Revoked" as const)
    : result.data.expiresAt < now
      ? ("Expired" as const)
      : ("Active" as const);

  return {
    state,
    certificate: {
      learnerName: learner.data?.fullName ?? "—",
      companyName: company.data?.name ?? "—",
      trackTitle: result.data.trackTitle,
      issuedAt: result.data.issuedAt,
      expiresAt: result.data.expiresAt,
      contentVersion: result.data.contentVersion,
      examScorePercent: `${round(Number(result.data.examScore) * 100, 0)}%`,
      challengeSlugs: result.data.challengeSlugs ?? [],
      verificationCode: result.data.verificationCode
    }
  };
}

export default function VerifyCertificateRoute() {
  const { state, certificate } = useLoaderData<typeof loader>();

  if (state === "NotFound" || !certificate) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Certificate not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This verification link does not match a certificate. Check the code
            and try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  const statusColor =
    state === "Active" ? "green" : state === "Expired" ? "orange" : "red";

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <HStack className="w-full justify-between items-start">
          <VStack spacing={1}>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Certificate of completion
            </span>
            <CardTitle className="text-2xl">{certificate.trackTitle}</CardTitle>
          </VStack>
          <Status color={statusColor}>{state}</Status>
        </HStack>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          <VStack spacing={1}>
            <span className="text-sm text-muted-foreground">Awarded to</span>
            <span className="text-xl font-semibold">
              {certificate.learnerName}
            </span>
            <span className="text-sm text-muted-foreground">
              {certificate.companyName}
            </span>
          </VStack>

          <VStack spacing={2} className="w-full">
            <span className="text-sm font-medium">Criteria met</span>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>
                Certification exam passed with {certificate.examScorePercent}
              </li>
              <li>
                {certificate.challengeSlugs.length} hands-on{" "}
                {certificate.challengeSlugs.length === 1
                  ? "challenge"
                  : "challenges"}{" "}
                verified against real records in Carbon
              </li>
            </ul>
          </VStack>

          <VStack spacing={1} className="w-full pt-2 border-t border-border">
            <HStack className="w-full justify-between">
              <span className="text-sm text-muted-foreground">Issued</span>
              <span className="text-sm tabular-nums">
                {formatDate(certificate.issuedAt.slice(0, 10))}
              </span>
            </HStack>
            <HStack className="w-full justify-between">
              <span className="text-sm text-muted-foreground">Valid until</span>
              <span className="text-sm tabular-nums">
                {formatDate(certificate.expiresAt.slice(0, 10))}
              </span>
            </HStack>
            <HStack className="w-full justify-between">
              <span className="text-sm text-muted-foreground">
                Content version
              </span>
              <span className="text-sm font-mono">
                {certificate.contentVersion}
              </span>
            </HStack>
            <HStack className="w-full justify-between">
              <span className="text-sm text-muted-foreground">
                Verification code
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {certificate.verificationCode}
              </span>
            </HStack>
          </VStack>
        </VStack>
      </CardContent>
    </Card>
  );
}
