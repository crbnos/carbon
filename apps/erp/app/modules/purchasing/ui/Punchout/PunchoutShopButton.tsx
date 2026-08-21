import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuShoppingCart } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type PunchoutStartData = {
  startPageUrl?: string;
  sessionId?: string;
};

type PunchoutStatusData = {
  status?: string;
};

const PunchoutShopButton = ({
  purchaseOrderId
}: {
  purchaseOrderId?: string;
}) => {
  const { t } = useLingui();

  const startFetcher = useFetcher<PunchoutStartData>();
  const consumeFetcher = useFetcher();
  const statusFetcher = useFetcher<PunchoutStatusData>();

  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const consumedRef = useRef(false);

  const start = () => {
    const formData = new FormData();
    if (purchaseOrderId) formData.append("purchaseOrderId", purchaseOrderId);
    startFetcher.submit(formData, {
      method: "post",
      action: path.to.api.punchoutStart
    });
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSessionId(null);
    consumedRef.current = false;
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
  }, []);

  const consume = useCallback(
    (sid: string) => {
      if (consumedRef.current) return;
      consumedRef.current = true;
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
      // The consume action redirects the ERP tab to the created PO.
      consumeFetcher.submit(null, {
        method: "post",
        action: path.to.api.punchoutConsume(sid)
      });
    },
    [consumeFetcher]
  );

  // Once the start action returns a session, open the shopping popup and the
  // waiting modal. Opens a centered popup, falling back to a new tab when the
  // popup is blocked — never a full redirect of the ERP tab.
  useEffect(() => {
    const data = startFetcher.data;
    if (!data?.startPageUrl || !data?.sessionId) return;
    if (sessionId === data.sessionId) return;

    setSessionId(data.sessionId);
    consumedRef.current = false;
    setIsOpen(true);

    const width = 1100;
    const height = 800;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2.5;

    let popup = window.open(
      data.startPageUrl,
      "punchout",
      `width=${width},height=${height},left=${left},top=${top}`
    );
    if (!popup || popup.closed) {
      popup = window.open(data.startPageUrl, "_blank");
    }
    popupRef.current = popup;
  }, [startFetcher.data, sessionId]);

  // Primary return path: the popup posts a message back to the opener.
  useEffect(() => {
    if (!isOpen || !sessionId) return;

    const handler = (event: MessageEvent) => {
      if (event.data === `punchout:returned:${sessionId}`) {
        consume(sessionId);
      } else if (event.data === `punchout:cancelled:${sessionId}`) {
        handleClose();
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isOpen, sessionId, consume, handleClose]);

  // Fallback for COOP/popup cases where postMessage never arrives: poll the
  // session status every 3s while the modal is open.
  useEffect(() => {
    if (!isOpen || !sessionId) return;

    const interval = setInterval(() => {
      statusFetcher.load(path.to.api.punchoutStatus(sessionId));
    }, 3000);

    return () => clearInterval(interval);
  }, [isOpen, sessionId, statusFetcher]);

  useEffect(() => {
    if (statusFetcher.data?.status === "Returned" && sessionId) {
      consume(sessionId);
    }
  }, [statusFetcher.data, sessionId, consume]);

  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<LuShoppingCart />}
        isLoading={startFetcher.state !== "idle"}
        isDisabled={startFetcher.state !== "idle"}
        onClick={start}
      >
        {t`Add from McMaster-Carr`}
      </Button>

      {isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Shopping on McMaster-Carr</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>Check out there to bring your cart back.</Trans>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={handleClose}>
                <Trans>Cancel</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
};

export default PunchoutShopButton;
