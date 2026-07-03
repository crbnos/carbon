import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuArrowUpRight } from "react-icons/lu";
import { Link } from "react-router";

type MetricCardProps = {
  title: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  to?: string;
  linkLabel?: string;
  description?: ReactNode;
  className?: string;
};

const MetricCard = ({
  title,
  value,
  icon,
  to,
  linkLabel,
  description,
  className
}: MetricCardProps) => {
  const { t } = useLingui();

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center gap-2">
        {icon && (
          <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
        )}
        <CardTitle className="flex-1 min-w-0 truncate line-clamp-none">
          {title}
        </CardTitle>
        {to && (
          <Button
            aria-label={linkLabel}
            asChild
            variant="secondary"
            size="sm"
            rightIcon={<LuArrowUpRight />}
            className="flex-shrink-0 -my-1"
          >
            <Link to={to}>{t`View`}</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <h3 className="text-4xl font-medium tracking-tighter tabular-nums truncate">
          {value}
        </h3>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </CardContent>
    </Card>
  );
};

export default MetricCard;
