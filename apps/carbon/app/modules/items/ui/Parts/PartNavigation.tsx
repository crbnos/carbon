import { DetailSidebar } from "~/components/Layout";
import { usePartNavigation } from "./usePartNavigation";

const PartNavigation = () => {
  const links = usePartNavigation();

  return <DetailSidebar links={links} />;
};

export default PartNavigation;
