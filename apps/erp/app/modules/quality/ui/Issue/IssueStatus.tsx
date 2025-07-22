import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type IssueStatusProps = {
  status?: Database["public"]["Enums"]["nonConformanceStatus"] | null;
};

const IssueStatus = ({ status }: IssueStatusProps) => {
  switch (status) {
    case "Registered":
      return <Status color="gray">{status}</Status>;
    case "In Progress":
      return <Status color="orange">{status}</Status>;
    case "Closed":
      return <Status color="green">{status}</Status>;
    default:
      return null;
  }
};

export default IssueStatus;
