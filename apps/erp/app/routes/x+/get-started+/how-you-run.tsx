import { HowYouRunView } from "@carbon/onboarding/ui";
import { useNavigate } from "react-router";
import { path } from "~/utils/path";

export default function GetStartedHowYouRunRoute() {
  const navigate = useNavigate();
  return (
    <HowYouRunView onRetune={() => navigate(path.to.getStartedIntake)} />
  );
}
