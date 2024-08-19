import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";

type PersonOvertimeProps = {};

const PersonOvertime = (props: PersonOvertimeProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Overtime</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground p-4 w-full text-center">
          No overtime scheduled
        </div>
      </CardContent>
    </Card>
  );
};

export default PersonOvertime;
