import { memo } from "react";
import IntercompanyDocumentLinkTable from "./IntercompanyDocumentLinkTable";

type IntercompanyDocumentLink = {
  id: string;
  sourceDocumentType: string;
  targetDocumentType: string;
  status: string;
  failureReason: string | null;
  sourceCompany: { name: string } | null;
  targetCompany: { name: string } | null;
};

type MirroringTabProps = {
  links: IntercompanyDocumentLink[];
  linksCount: number;
};

const MirroringTab = memo(({ links, linksCount }: MirroringTabProps) => {
  return <IntercompanyDocumentLinkTable data={links} count={linksCount} />;
});

MirroringTab.displayName = "MirroringTab";
export default MirroringTab;
