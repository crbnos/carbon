import { Status } from "@carbon/react";
import { ItemStatus, type Item } from "../types";

type KanbanStatusProps = NonNullable<Item["status"]>;

const KanbanStatus = ({ status, message }: KanbanStatusProps) => {
  switch (status) {
    case ItemStatus.Warning:
      return (
        <Status className="w-fit" color="orange">
          {message}
        </Status>
      );
    case ItemStatus.Success:
      return (
        <Status className="w-fit" color="green">
          {message}
        </Status>
      );
    case ItemStatus.Error:
      return (
        <Status className="w-fit" color="red">
          {message}
        </Status>
      );
    case ItemStatus.Info:
      return (
        <Status className="w-fit" color="blue">
          {message}
        </Status>
      );
    case ItemStatus.Default:
    default:
      return (
        <Status className="w-fit" color="gray">
          {message}
        </Status>
      );
  }
};

export default KanbanStatus;
