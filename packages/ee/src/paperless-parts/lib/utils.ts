import type { Database } from "@carbon/database";
import { CalendarDate, getLocalTimeZone, today } from "@internationalized/date";

export function calculatePromisedDate(
  leadTime: number,
  holidays: Database["public"]["Tables"]["holiday"]["Row"][]
) {
  const now = new Date();
  const cutoffHour = 10;
  const timeZone = getLocalTimeZone();

  let startDate = today(timeZone);

  if (now.getHours() >= cutoffHour) {
    startDate = startDate.add({ days: 1 });
  }

  const holidayDates = new Set(
    holidays.map((holiday) => {
      const parts = holiday.date.split("-").map(Number);
      return new CalendarDate(parts[0]!, parts[1]!, parts[2]!).toString();
    })
  );

  let businessDaysAdded = 0;
  let currentDate = startDate;

  while (businessDaysAdded < leadTime) {
    currentDate = currentDate.add({ days: 1 });

    const dayOfWeek = currentDate.toDate(timeZone).getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    const isNotHoliday = !holidayDates.has(currentDate.toString());

    if (isWeekday && isNotHoliday) {
      businessDaysAdded++;
    }
  }

  return currentDate.toDate(timeZone).toISOString();
}
