import { planAnchorId, SUPPORT_BOOKING_URL } from "@carbon/onboarding";
import { OnboardingHub } from "@carbon/onboarding/ui";
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import Confetti from "react-confetti";
import { createPortal } from "react-dom";
import { useFetcher, useLocation, useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import { trainingConfig } from "~/utils/training";

// Each nested product step opens where you do it. "Set up your data" lands on
// the Setup Map — the configuration checklist that deep-links each ERP screen —
// rather than jumping straight into one screen.
const PRODUCT_PATH: Record<string, string> = {
  "prod:configure-data": path.to.getStartedPage("setup"),
  "prod:configure-bom": path.to.parts,
  "prod:configure-builtins": path.to.production,
  "prod:purchase-make": path.to.jobs,
  "prod:serialize-sell": path.to.salesOrders
};

// Hub state comes from <HubProvider> in the layout. This route only injects the
// Carbon-app routing + video resolution the package can't reach.
export default function GetStartedStartRoute() {
  const { company } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [celebrate, setCelebrate] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  // Viewport size for the full-screen canvas (window is undefined during SSR).
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const update = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Celebrate when the layout routes here right after the final checkpoint
  // clears (it passes `justCompleted`). Cleared from history so a refresh or
  // back-nav doesn't replay the confetti.
  const justCompleted = (location.state as { justCompleted?: boolean } | null)
    ?.justCompleted;
  useEffect(() => {
    if (justCompleted) {
      setCelebrate(true);
      navigate(".", { replace: true, state: {} });
    }
  }, [justCompleted, navigate]);

  // Also fire if the final gate flips while the user is already on this screen.
  const onComplete = () => {
    setCelebrate(true);
  };

  // Exiting writes status="complete" through the state action, then sends the
  // customer to the (now un-hijacked) app home. A dedicated fetcher lets us wait
  // for the write to land before navigating away and unmounting this route.
  const exitFetcher = useFetcher<{ success?: boolean }>();
  const exitingRef = useRef(false);
  const confirmExit = () => {
    exitingRef.current = true;
    exitFetcher.submit(
      { intent: "setStatus", status: "complete" },
      { method: "post", action: path.to.getStartedState }
    );
  };
  useEffect(() => {
    if (
      exitingRef.current &&
      exitFetcher.state === "idle" &&
      exitFetcher.data &&
      exitFetcher.data.success !== false
    ) {
      exitingRef.current = false;
      setExitOpen(false);
      navigate(path.to.authenticatedRoot);
    }
  }, [exitFetcher.state, exitFetcher.data, navigate]);

  const exiting = exitFetcher.state !== "idle";

  return (
    <>
      {celebrate && size.width > 0
        ? createPortal(
            // Portal to <body>: the get-started layout has overflow-hidden +
            // transformed ancestors that would clip/contain a fixed canvas.
            <Confetti
              width={size.width}
              height={size.height}
              recycle={false}
              numberOfPieces={500}
              gravity={0.25}
              style={{ position: "fixed", inset: 0, zIndex: 9999 }}
              onConfettiComplete={(confetti) => {
                confetti?.reset();
                setCelebrate(false);
              }}
            />,
            document.body
          )
        : null}
      <OnboardingHub
        companyName={company.name}
        onComplete={onComplete}
        onExit={() => setExitOpen(true)}
        onContactExpert={() =>
          window.open(SUPPORT_BOOKING_URL, "_blank", "noopener,noreferrer")
        }
        onOpenProduct={(key) =>
          navigate(PRODUCT_PATH[key] ?? path.to.getStarted)
        }
        onOpenPage={(slug) => navigate(path.to.getStartedPage(slug))}
        onOpenInPlan={(stepKey) =>
          navigate(`${path.to.getStartedPage("plan")}#${planAnchorId(stepKey)}`)
        }
        resolveVideoUrl={(videoKey) => {
          const video = trainingConfig[videoKey];
          return video?.academyUrl ?? video?.videoUrl;
        }}
      />

      <Modal open={exitOpen} onOpenChange={setExitOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Finish onboarding?</ModalTitle>
            <ModalDescription>
              Every phase is done. The home screen goes back to normal — you can
              reopen this hub anytime from the nav.
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => setExitOpen(false)}
              isDisabled={exiting}
            >
              Not yet
            </Button>
            <Button
              onClick={confirmExit}
              isLoading={exiting}
              isDisabled={exiting}
            >
              Finish onboarding
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
