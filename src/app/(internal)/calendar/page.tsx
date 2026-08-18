import { CourtCalendar, ScheduleHearingForm } from "./CalendarScreen";
import { PageHead } from "@/components/ui";

export default function CalendarPage() {
  return (
    <>
      <PageHead title="Court &amp; Hearing Calendar">
        <ScheduleHearingForm />
      </PageHead>
      <p className="page-subtitle">
        The firm&rsquo;s daily court diary, with adjournment tracking and smart
        reminders per listing.
      </p>

      <CourtCalendar />
    </>
  );
}
