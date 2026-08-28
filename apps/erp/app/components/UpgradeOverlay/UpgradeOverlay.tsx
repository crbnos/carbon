import {
  Button,
  Card,
  CardContent,
  cn,
  Modal,
  ModalContent,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { path } from "~/utils/path";

type WithChildren = { children: ReactNode; className?: string };

function UpgradeOverlayRoot({ children, className }: WithChildren) {
  return (
    <div
      className={cn(
        "relative w-full h-full min-h-[calc(100dvh-49px)]",
        className
      )}
    >
      {children}
    </div>
  );
}

function UpgradeOverlayPreview({ children, className }: WithChildren) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "blur-[2px] pointer-events-none select-none w-full h-full",
        className
      )}
    >
      {children}
    </div>
  );
}

function UpgradeOverlayCard({ children, className }: WithChildren) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Card className={cn("max-w-md shadow-lg", className)}>
        <CardContent className="flex flex-col items-center text-center gap-4 pt-6">
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function UpgradeOverlayInline({ children, className }: WithChildren) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-start flex-1 w-full pt-[15dvh] text-center gap-4 px-4 h-full",
        className
      )}
    >
      {children}
    </div>
  );
}

function UpgradeOverlayIcon({ children }: { children: ReactNode }) {
  return <div className="rounded-full bg-muted p-3">{children}</div>;
}

function UpgradeOverlayTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold">{children}</h3>;
}

function UpgradeOverlayDescription({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground text-balance">{children}</p>
  );
}

function UpgradeOverlayContent({ children }: { children: ReactNode }) {
  return <VStack className="gap-2 items-center">{children}</VStack>;
}

function UpgradeOverlayActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-2">{children}</div>;
}

function UpgradeOverlayStickyGradient({
  children,
  className,
  onClick
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 left-0 right-0 z-40 pointer-events-none",
        "-mt-[100dvh] h-[100dvh] flex items-end justify-center pb-48",
        "bg-gradient-to-b from-transparent via-background/55 via-[50%] to-background",
        "transition-opacity duration-200 ease-out",
        "motion-reduce:transition-none",
        className
      )}
    >
      <div
        onClick={onClick}
        className="pointer-events-auto px-4 w-full flex flex-col items-center text-center gap-3 max-w-md mx-auto cursor-pointer rounded-md"
      >
        {children}
      </div>
    </div>
  );
}

function UpgradeOverlayDialog({
  open,
  onOpenChange,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-md bg-card dark:bg-muted/40">
        <div className="flex flex-col items-center text-center gap-4 px-6 pt-4 pb-8">
          {children}
        </div>
      </ModalContent>
    </Modal>
  );
}

/**
 * Generic section-level gate: blurs the real (inert) section and centers the
 * upgrade card over it. Unlike the full-page overlays, it sizes to the section
 * — the min-height only guarantees the card fits over short content.
 */
function UpgradeOverlaySection({
  icon,
  title,
  description,
  children,
  className
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <UpgradeOverlayRoot className={cn("min-h-80", className)}>
      <UpgradeOverlayPreview className="flex min-h-80 flex-col justify-center">
        {children}
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>{icon}</UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>{title}</UpgradeOverlayTitle>
          <UpgradeOverlayDescription>{description}</UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlayRoot>
  );
}

function UpgradeOverlayUpgradeButton({
  children,
  to = path.to.billing
}: {
  children?: ReactNode;
  to?: string;
}) {
  return (
    <Button asChild>
      <Link to={to}>{children ?? <Trans>Upgrade to Business</Trans>}</Link>
    </Button>
  );
}

const UpgradeOverlay = UpgradeOverlayRoot;

export {
  UpgradeOverlay,
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayDialog,
  UpgradeOverlayIcon,
  UpgradeOverlayInline,
  UpgradeOverlayPreview,
  UpgradeOverlaySection,
  UpgradeOverlayStickyGradient,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
};
