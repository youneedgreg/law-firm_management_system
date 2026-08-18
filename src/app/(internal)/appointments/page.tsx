import { AppointmentList, ScheduleAppointmentForm } from "./AppointmentsScreen";
import { PageHead } from "@/components/ui";

export default function AppointmentsPage() {
  return (
    <>
      <PageHead title="Appointments">
        <ScheduleAppointmentForm />
      </PageHead>

      <AppointmentList />
    </>
  );
}
