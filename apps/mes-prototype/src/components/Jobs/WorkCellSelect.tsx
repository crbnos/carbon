import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@carbon/react";
import { useNavigate, useParams } from "react-router-dom";
import { path } from "~/config";
import type { WorkCell } from "~/lib/data";

interface WorkCellSelectProps {
  value: string;
  onChange: (value: string) => void;
  workCells: WorkCell[];
}

export function WorkCellSelect({
  value,
  workCells,
  onChange,
}: WorkCellSelectProps) {
  const navigate = useNavigate();
  const { operationId } = useParams();
  return (
    <Select
      value={value}
      onValueChange={(value) => {
        onChange(value);
        if (operationId) navigate(path.to.jobs);
      }}
    >
      <SelectTrigger aria-label="Select work cell">
        <SelectValue placeholder="Select a work cell">
          {workCells.find((cell) => cell.id === value)?.title}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {workCells.map((cell) => (
          <SelectItem key={cell.id} value={cell.id}>
            {cell.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
