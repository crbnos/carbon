import { DetailSidebar } from "~/components/Layout";
import { usePersonSidebar } from "./usePersonSidebar";

const PersonSidebar = () => {
  const links = usePersonSidebar();

  return <DetailSidebar links={links} />;
};

export default PersonSidebar;
