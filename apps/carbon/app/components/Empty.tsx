import { VStack } from "@carbon/react";
import type { ReactNode } from "react";
import { LuGhost } from "react-icons/lu";

export default function Empty({ children }: { children: ReactNode }) {
  return (
    <VStack className="w-full h-full justify-center items-center">
      <LuGhost className="w-12 h-12" />
      <h3 className="text-base">Pretty empty around here</h3>
      {children}
    </VStack>
  );
}
