import { Effect, Either } from "effect";
import { attemptAs } from "@/runtime/session";
import { ReportService } from "@/services/report-service";
import { day, money, percent, toCsv } from "../../csv";

/**
 * Report exports, as CSV.
 *
 * A route handler rather than a Server Action, for the same reason the document
 * download is one: an export needs an `href`. An anchor with a real URL is
 * something a browser understands — middle-clickable, copyable, working before
 * hydration — and a Server Action returning a string for the client to turn
 * into a Blob is the same round trip with more moving parts.
 *
 * ## The permission is the service's, not this file's
 *
 * There is no check here. `ReportService.all` refuses anyone without
 * `staff:read` and omits the money sections from anyone without
 * `invoice:read` — so an export requested by a Receptionist comes back with the
 * caseload and no figures, rather than with a 403 or, worse, with the figures.
 * A second copy of the rule in this file is a second copy to forget.
 *
 * ## `Content-Disposition` names the file with the date in it
 *
 * `ageing-2026-08-21.csv`, not `export.csv`. A partner runs this monthly and
 * ends up with a directory of them; a name that does not say which month it is
 * makes the whole set useless, and nobody renames downloads.
 */

const REPORTS = ["ageing", "debtors", "productivity", "monthly"] as const;

type Report = (typeof REPORTS)[number];

const isReport = (value: string): value is Report =>
  REPORTS.includes(value as Report);

export async function GET(
  _request: Request,
  context: RouteContext<"/reports/export/[report]">,
) {
  const { report } = await context.params;

  if (!isReport(report)) {
    return new Response("No such report", { status: 404 });
  }

  const outcome = await attemptAs(
    Effect.flatMap(ReportService, (service) => service.all()),
  );

  if (Either.isLeft(outcome)) {
    const status = outcome.left._tag === "NotPermitted" ? 403 : 500;
    return new Response(status === 403 ? "Forbidden" : "Unavailable", {
      status,
    });
  }

  const reports = outcome.right;

  /**
   * A money report the caller may not see is `403`, not an empty file.
   *
   * The distinction matters: an empty CSV looks like a firm with no debtors,
   * and somebody will act on it. A refusal is unambiguous.
   */
  const rows = ((): readonly (readonly string[])[] | undefined => {
    switch (report) {
      case "ageing":
        return reports.ageing === undefined
          ? undefined
          : [
              ["Band", "Invoices", "Outstanding"],
              ...reports.ageing.map((band) => [
                band.label,
                String(band.count),
                money(band.outstanding),
              ]),
            ];

      case "debtors":
        return reports.debtors === undefined
          ? undefined
          : [
              ["Client", "Invoices", "Outstanding", "Oldest due", "Days"],
              ...reports.debtors.map((row) => [
                row.clientName,
                String(row.invoices),
                money(row.outstanding),
                day(row.oldestDueOn),
                String(row.daysOverdue),
              ]),
            ];

      case "monthly":
        return reports.monthly === undefined
          ? undefined
          : [
              ["Month", "Billed", "Collected"],
              ...reports.monthly.map((row) => [
                row.month,
                money(row.billed),
                money(row.collected),
              ]),
            ];

      case "productivity":
        return reports.earners === undefined
          ? undefined
          : [
              [
                "Fee earner",
                "Hours",
                "Billable hours",
                "Utilisation %",
                "Recorded",
                "Billed",
                "Realisation %",
              ],
              ...reports.earners.map((row) => [
                row.name,
                String(row.hours),
                String(row.billableHours),
                percent(row.utilisation),
                money(row.recorded),
                money(row.billed),
                percent(row.realisation),
              ]),
            ];
    }
  })();

  if (rows === undefined) {
    return new Response("Forbidden", { status: 403 });
  }

  /**
   * A byte-order mark in front of the CSV.
   *
   * Excel on Windows reads a UTF-8 file as Latin-1 unless the BOM tells it
   * otherwise, which turns every non-ASCII character into mojibake in the one
   * program most likely to open this. Kenyan client names carry no accents
   * today and a firm's file eventually does.
   */
  return new Response(`\uFEFF${toCsv(rows)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${report}-${day(reports.asAt)}.csv"`,
      /** A report is a snapshot; a cached one is a wrong one. */
      "cache-control": "no-store",
    },
  });
}
