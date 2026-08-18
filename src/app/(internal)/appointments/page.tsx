import { PageHead } from "@/components/ui";
import { APPOINTMENTS } from "@/lib/data/work";

export default function AppointmentsPage() {
  return (
    <>
      <PageHead title="Appointments">
        <span className="btn btn-primary">
          <i className="ph-duotone ph-calendar-plus" aria-hidden /> Schedule
        </span>
      </PageHead>

      {APPOINTMENTS.map((appointment) => (
        <div className="row row-split" key={appointment.id}>
          <div>
            <div className="row-title">{appointment.title}</div>
            <div className="row-meta">
              {appointment.with} · {appointment.type}
            </div>
          </div>
          <div style={{ fontSize: 14, whiteSpace: "nowrap" }}>
            {appointment.date} {appointment.time}
          </div>
        </div>
      ))}
    </>
  );
}
