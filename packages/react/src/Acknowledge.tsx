import type { ComponentProps, ReactNode } from "react";
import { useEffect } from "react";
import { Form, useFetcher } from "react-router";
import { Button } from "./Button";
import type useDisclosure from "./hooks/useDisclosure";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "./Modal";
import { toast } from "./Toast";

/** 
 * 
export function AcademyBanner({
  acknowledgeAction
}: {
  acknowledgeAction: string;
}) {
  const fetcher = useFetcher<{}>();
  
  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 flex items-center justify-between gap-10  bg-[#212278] dark:bg-[#2f31ae] text-white py-1 px-2 rounded-lg z-50 shadow-md">
    <div />
    <fetcher.Form method="post" action={acknowledgeAction}>
    <input type="hidden" name="intent" value="academy" />
    <input
    type="hidden"
    name="redirectTo"
    value="https://learn.carbon.ms"
    />
    <Button
    type="submit"
    variant="ghost"
    size="lg"
    className="hover:bg-transparent text-white hover:text-white"
    rightIcon={<LuArrowUpRight />}
    >
    <span>Introducing Carbon Academy</span>
    </Button>
    </fetcher.Form>
    <fetcher.Form method="post" action={acknowledgeAction}>
    <input type="hidden" name="intent" value="academy" />
    <IconButton
    type="submit"
    aria-label="Close"
    variant="ghost"
    className="text-white dark:text-white hover:text-white"
    icon={<LuX />}
    />
    </fetcher.Form>
    </div>
  );
}
*/

export function ItarLoginDisclaimer() {
  return (
    <p className="text-sm text-muted-foreground">
      This is an ITAR-controlled solution. Access and use are restricted to U.S.
      Persons only
    </p>
  );
}

export function ItarDisclosure({
  disclosure
}: {
  disclosure: ReturnType<typeof useDisclosure>;
}) {
  return (
    <Modal
      open={disclosure.isOpen}
      onOpenChange={(open) => {
        if (!open) disclosure.onClose();
      }}
    >
      <ModalContent size="medium">
        <ModalHeader>
          <ModalTitle>ITAR-controlled solution</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground">
            This is an ITAR-controlled solution. Access and use are restricted
            to U.S. Persons only
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={disclosure.onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ITAR certification gate
//
// Legal copy below is intentionally hardcoded English and MUST NOT be wrapped in
// <Trans> / translated — altering the wording changes its legal meaning. The
// checkboxes are native inputs so the browser enforces `required` before submit;
// the acknowledge action re-validates authoritatively server-side.
// ---------------------------------------------------------------------------

function ItarCertificationField({
  name,
  label,
  type = "text",
  placeholder
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        name={name}
        required
        placeholder={placeholder}
        className="flex h-9 w-full rounded-md bg-input/30 px-3 py-1 text-sm shadow-xs outline-none border border-muted-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </label>
  );
}

function ItarCheckbox({ name, children }: { name: string; children: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        name={name}
        required
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="text-pretty">{children}</span>
    </label>
  );
}

function useAcknowledgeFetcher() {
  const fetcher = useFetcher<{ success: boolean; message: string }>();
  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data?.message);
    }
  }, [fetcher.data]);
  return fetcher;
}

/**
 * Screen 1 — shown once per company to the first admin who can bind it, before
 * anyone can use the controlled environment.
 */
export function ItarEntityCertification({
  companyName,
  riderPdfPath,
  acknowledgeAction,
  logoutAction
}: {
  companyName: string;
  riderPdfPath: string;
  acknowledgeAction: string;
  logoutAction: string;
}) {
  const fetcher = useAcknowledgeFetcher();
  const isLoading = fetcher.state !== "idle";

  return (
    <Modal open>
      <ModalContent size="large" withCloseButton={false}>
        <ModalHeader>
          <ModalTitle className="text-balance">
            Accept the Carbon GovCloud Rider on behalf of your company
          </ModalTitle>
        </ModalHeader>
        {/* Form wraps only the fields — the logout FormButton renders its own
            <form>, so it must be a sibling, not nested (nested <form> is invalid
            HTML; the browser drops the inner one and the logout button would
            submit this certification form instead). The submit button lives in
            the footer and targets this form by id. */}
        <fetcher.Form
          id="itar-entity-cert"
          method="post"
          action={acknowledgeAction}
        >
          <input type="hidden" name="intent" value="itar-entity" />
          <ModalBody>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground text-pretty">
                You are setting up access to Carbon's ITAR-controlled
                environment. Before your company can use it, a representative
                with authority to bind it must accept the Carbon GovCloud Rider,
                which governs U.S.-Persons-only access and each party's export
                control responsibilities.{" "}
                <a
                  href={riderPdfPath}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  View the full Rider
                </a>
              </p>

              <div className="flex flex-col gap-3">
                <ItarCheckbox name="authorityToBind">
                  {`I have authority to bind ${companyName} to the Carbon GovCloud Rider.`}
                </ItarCheckbox>
                <ItarCheckbox name="acceptRider">
                  {`On behalf of ${companyName}, I accept the Carbon GovCloud Rider, including its U.S.-Persons-only access requirement and the Customer obligations in Section 3.`}
                </ItarCheckbox>
              </div>

              <div className="flex flex-col gap-3">
                <ItarCertificationField
                  name="fullLegalName"
                  label="Full legal name"
                />
                <ItarCertificationField name="title" label="Title" />
                <ItarCertificationField
                  name="complianceContact"
                  label="Export compliance contact for notices (name and email)"
                />
              </div>
            </div>
          </ModalBody>
        </fetcher.Form>
        <ModalFooter>
          <Button
            type="submit"
            form="itar-entity-cert"
            isLoading={isLoading}
            isDisabled={isLoading}
          >
            {`Accept on behalf of ${companyName}`}
          </Button>
          <FormButton
            action={logoutAction}
            variant="secondary"
            isDisabled={isLoading}
          >
            Cancel
          </FormButton>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Screen 2 — shown to every user at first login and again when their
 * certification expires (365 days).
 */
export function ItarUserCertification({
  riderPdfPath,
  acknowledgeAction,
  logoutAction
}: {
  riderPdfPath?: string;
  acknowledgeAction: string;
  logoutAction: string;
}) {
  const fetcher = useAcknowledgeFetcher();
  const isLoading = fetcher.state !== "idle";

  return (
    <Modal open>
      <ModalContent size="large" withCloseButton={false}>
        <ModalHeader>
          <ModalTitle>ITAR-Controlled Environment</ModalTitle>
        </ModalHeader>
        {/* Form wraps only the fields; the logout FormButton is a sibling in the
            footer (see the entity screen for why nesting <form> is invalid). */}
        <fetcher.Form
          id="itar-user-cert"
          method="post"
          action={acknowledgeAction}
        >
          <input type="hidden" name="intent" value="itar-user" />
          <ModalBody>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground text-pretty">
                This environment stores and processes technical data controlled
                under the International Traffic in Arms Regulations (ITAR).
                Access is restricted to U.S. Persons.
              </p>
              <p className="text-sm text-muted-foreground text-pretty">
                A U.S. Person is a U.S. citizen or U.S. national, a lawful
                permanent resident (Green Card holder), or a protected
                individual such as an admitted refugee or asylee. If you are
                none of these, you are not permitted to proceed, regardless of
                who invited you or where you are located.
                {riderPdfPath ? (
                  <>
                    {" "}
                    <a
                      href={riderPdfPath}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-foreground underline underline-offset-2"
                    >
                      View the full Rider
                    </a>
                  </>
                ) : null}
              </p>

              <div className="flex flex-col gap-3">
                <ItarCheckbox name="certifyUsPerson">
                  I certify that I am a U.S. Person as defined above.
                </ItarCheckbox>
                <ItarCheckbox name="agreeNotify">
                  I agree to notify Carbon and my employer immediately if my
                  U.S. Person status changes, and to stop using this environment
                  until my access is re-confirmed.
                </ItarCheckbox>
                <ItarCheckbox name="understandPenalty">
                  I understand that a false attestation may violate U.S. export
                  control law, including the Arms Export Control Act, and can
                  carry civil and criminal penalties.
                </ItarCheckbox>
              </div>

              <ItarCertificationField
                name="fullLegalName"
                label="Full legal name"
              />
            </div>
          </ModalBody>
        </fetcher.Form>
        <ModalFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs italic text-muted-foreground text-pretty">
            This attestation expires 365 days after submission. Continued access
            requires re-attestation against the then-current version of this
            Rider.
          </p>
          <div className="flex items-center gap-2">
            <FormButton
              action={logoutAction}
              variant="secondary"
              isDisabled={isLoading}
            >
              I am not a U.S. Person
            </FormButton>
            <Button
              type="submit"
              form="itar-user-cert"
              isLoading={isLoading}
              isDisabled={isLoading}
            >
              Submit and enter
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Shown when the company has no valid entity Rider acceptance yet and this user
 * is not authorized to accept it — they must wait for an administrator.
 */
export function ItarEntityPendingBlock({
  logoutAction
}: {
  logoutAction: string;
}) {
  return (
    <Modal open>
      <ModalContent size="medium" withCloseButton={false}>
        <ModalHeader>
          <ModalTitle>ITAR-Controlled Environment</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted-foreground text-pretty">
            A representative of your company must accept the Carbon GovCloud
            Rider before anyone can enter. Please contact your administrator.
          </p>
        </ModalBody>
        <ModalFooter>
          <FormButton action={logoutAction} variant="secondary">
            Log out
          </FormButton>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function FormButton({
  action,
  children,
  variant,
  isDisabled
}: {
  action: string;
  children: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  isDisabled?: boolean;
}) {
  return (
    <Form method="post" action={action}>
      <Button type="submit" variant={variant} isDisabled={isDisabled}>
        {children}
      </Button>
    </Form>
  );
}
