import { Status } from "@carbon/react";
import { LuLock } from "react-icons/lu";
import type { qualityDocumentStatus } from "../../quality.models";

type QualityDocumentStatusProps = {
  status?: (typeof qualityDocumentStatus)[number] | null;
};

const QualityDocumentStatus = ({ status }: QualityDocumentStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Active":
      return (
        <Status color="green">
          <LuLock className="size-3 mr-1" />
          {status}
        </Status>
      );
    case "Archived":
      return (
        <Status color="red">
          <LuLock className="size-3 mr-1" />
          {status}
        </Status>
      );
    default:
      return null;
  }
};

export default QualityDocumentStatus;
