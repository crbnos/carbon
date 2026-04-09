import { Button } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { RefObject } from "react";
import {
  LuAudioLines,
  LuChevronDown,
  LuSearch,
  LuSquarePen
} from "react-icons/lu";
import { useUIStore } from "~/stores/ui";
import CreateMenu from "../Layout/Topbar/CreateMenu";
import type { RecordButtonRef } from "./RecordButton";

interface ChatWidgetsProps {
  recordButtonRef?: RefObject<RecordButtonRef>;
}

export function ChatWidgets({ recordButtonRef }: ChatWidgetsProps) {
  const { openSearchModal } = useUIStore();

  const handleVoiceClick = () => {
    recordButtonRef?.current?.handleRecordClick();
  };

  return (
    <div className="w-full flex gap-3 justify-center items-center">
      <Button
        variant="secondary"
        className="rounded-full"
        leftIcon={<LuSearch />}
        onClick={openSearchModal}
      >
        <Trans>Search</Trans>
      </Button>

      <CreateMenu
        trigger={
          <Button
            variant="secondary"
            className="rounded-full"
            leftIcon={<LuSquarePen />}
            rightIcon={<LuChevronDown />}
          >
            <Trans>Create</Trans>
          </Button>
        }
      />

      <Button
        variant="secondary"
        className="rounded-full"
        leftIcon={<LuAudioLines />}
        onClick={handleVoiceClick}
      >
        <Trans>Voice</Trans>
      </Button>
    </div>
  );
}
