import { prettifyKeyboardShortcut } from "@carbon/utils";
import { useOperatingSystem } from "../OperatingSystem";

export function usePrettifyShortcut() {
  const { platform } = useOperatingSystem();
  const isMac = platform === "mac";
  return (input: string) => prettifyKeyboardShortcut(input, isMac);
}
