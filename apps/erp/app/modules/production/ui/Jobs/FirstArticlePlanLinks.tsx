import { Fragment } from "react";
import { Link } from "react-router";
import { path } from "~/utils/path";
import type { FirstArticleWithoutPlan } from "../../production.service";

// The parts a release blocker names, each linking to the part's quality tab,
// where its First Article inspection plan slot is assigned.
export function FirstArticlePlanLinks({
  parts
}: {
  parts: FirstArticleWithoutPlan[];
}) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.makeMethodId}>
          {index > 0 && ", "}
          <Link
            to={path.to.partQuality(part.itemId)}
            className="font-medium underline-offset-2 hover:underline"
          >
            {part.description}
          </Link>
        </Fragment>
      ))}
    </>
  );
}
