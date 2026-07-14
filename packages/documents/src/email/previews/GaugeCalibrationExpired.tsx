import { NotificationEmail } from "../NotificationEmail";

// Preview fixture — mirrors what getNotificationContent builds for the
// GaugeCalibrationExpired event. Not shipped (not exported from index.ts).
export default function GaugeCalibrationExpiredPreview() {
  return (
    <NotificationEmail
      heading={"Gauge calibration expired"}
      preview={"Gauge calibration expired"}
      message={"Gauge GAUGE-14 is out of calibration"}
      reference={"GAUGE-14"}
      recipientName={"Naveen"}
      ctaLabel={"View gauge"}
      ctaUrl={"https://app.carbon.ms/x/gauge/1"}
      details={[
        {
          label: "Description",
          value: "Digital caliper 0-150mm"
        },
        {
          label: "Last calibrated",
          value: "Jan 5, 2026"
        },
        {
          label: "Due",
          value: "Jun 30, 2026"
        },
        {
          label: "Status",
          value: "Out-of-Calibration"
        }
      ]}
    />
  );
}
