import { Status } from "@carbon/react";
import type { Database } from "@carbon/database";

type NonConformanceStatusProps = {
  status?: Database["public"]["Enums"]["nonConformanceStatus"] | null;
};

const NonConformanceStatus = ({ status }: NonConformanceStatusProps) => {
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

export default NonConformanceStatus;
