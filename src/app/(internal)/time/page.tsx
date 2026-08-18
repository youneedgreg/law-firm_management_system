import { LogTimeForm, TimeTable } from "./TimeScreen";
import { PageHead } from "@/components/ui";

export default function TimeTrackingPage() {
  return (
    <>
      <PageHead title="Time Tracking">
        <LogTimeForm />
      </PageHead>
      <p className="page-subtitle">
        Research, court attendance, drafting and consultation time, logged
        against the matter that will be billed for it.
      </p>

      <TimeTable />
    </>
  );
}
