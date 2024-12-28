import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";

type PersonDaysOffProps = {};

const PersonDaysOff = (props: PersonDaysOffProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Days Off</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground p-4 w-full text-center">
          No days off scheduled
        </div>
      </CardContent>
    </Card>
  );
};

export default PersonDaysOff;
