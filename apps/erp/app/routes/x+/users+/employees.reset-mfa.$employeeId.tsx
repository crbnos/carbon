import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  adminDeleteTotpFactors,
  getTotpFactors
} from "@carbon/auth/mfa.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import type { Result } from "~/types";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, { update: "users" });

  const { employeeId } = params;
  if (!employeeId) throw new Error("Employee ID is required");

  // RLS scopes this read to the admin's company — a cross-company user id 404s.
  const user = await client
    .from("user")
    .select("id, firstName, lastName")
    .eq("id", employeeId)
    .single();

  if (user.error || !user.data) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(request, error(user.error, "User not found"))
    );
  }

  const factors = await getTotpFactors(employeeId);

  return {
    user: user.data,
    hasFactors: factors.some((f) => f.status === "verified")
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  const { employeeId } = params;
  if (!employeeId) throw new Error("Employee ID is required");

  // Factors are global to the auth user, so make sure the target actually
  // belongs to the admin's company before touching them.
  const membership = await client
    .from("userToCompany")
    .select("userId")
    .eq("userId", employeeId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (membership.error || !membership.data) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(request, error(null, "User not found"))
    );
  }

  const deleted = await adminDeleteTotpFactors(employeeId);

  if (!deleted) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(null, "Failed to reset two-factor authentication")
      )
    );
  }

  throw redirect(
    path.to.employeeAccounts,
    await flash(
      request,
      success(
        "Two-factor authentication reset. The user can sign in with a magic link and set it up again."
      )
    )
  );
}

export default function ResetMfaRoute() {
  const { user, hasFactors } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const formFetcher = useFetcher<Result>();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <formFetcher.Form method="post" className="flex flex-col h-full">
          <ModalHeader>
            <ModalTitle>
              <Trans>
                Reset two-factor authentication for {user.firstName}{" "}
                {user.lastName}
              </Trans>
            </ModalTitle>
          </ModalHeader>

          <ModalBody>
            <VStack spacing={4}>
              {hasFactors ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    This removes their authenticator app, so their next sign-in
                    only needs a magic link. Use this when they have lost access
                    to their authenticator. It affects their sign-in for every
                    company they belong to.
                  </Trans>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    This user does not have two-factor authentication enabled.
                  </Trans>
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(-1)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                variant="destructive"
                isLoading={formFetcher.state !== "idle"}
                isDisabled={formFetcher.state !== "idle" || !hasFactors}
              >
                <Trans>Reset Two-Factor Auth</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </formFetcher.Form>
      </ModalContent>
    </Modal>
  );
}
