"use client";

import { HearingDetail } from "./HearingDetail";
import { useRxValue } from "@effect-rx/rx-react";
import { hydratedRx, recordsRx } from "@/rx/session";
import { NotOnFile } from "@/components/ui";
import { CASES } from "@/lib/data/cases";

/** A listing added through the scheduling form, held in the session store. */
export function CreatedHearing({ id }: { id: number }) {
  const records = useRxValue(recordsRx);
  const hydrated = useRxValue(hydratedRx);

  if (!hydrated) return null;

  const hearing = records.hearings.find((entry) => entry.id === id);
  if (!hearing) {
    return (
      <NotOnFile backHref="/calendar" backLabel="Back to calendar">
        No hearing is listed under #{id}.
      </NotOnFile>
    );
  }

  const legalCase = CASES.find((entry) => entry.id === hearing.caseId);

  return <HearingDetail hearing={hearing} legalCase={legalCase} />;
}
