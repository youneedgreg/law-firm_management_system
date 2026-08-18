import { CommunicationLog, LogCommunicationForm } from "./CommunicationsScreen";
import { PageHead } from "@/components/ui";

export default function CommunicationsPage() {
  return (
    <>
      <PageHead title="Communications">
        <LogCommunicationForm />
      </PageHead>
      <p className="page-subtitle">
        Every email, call, SMS, WhatsApp message and meeting logged against the
        client it concerns.
      </p>

      <CommunicationLog />
    </>
  );
}
