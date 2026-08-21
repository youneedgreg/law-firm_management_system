import { Effect } from "effect";
import { SectionTitle, TableWrap } from "@/components/ui";
import { runAs } from "@/runtime/session";
import { FirmService } from "@/services/firm-service";

/**
 * The staff register, read from Postgres.
 *
 * ## The list at the top is the reason this page is worth having
 *
 * Not the headcount — **whose practising certificate does not cover this
 * year**. An advocate without a current certificate may not appear, and
 * `mayAppearInCourt` has refused to assign them a matter since Phase 2; what
 * has never existed is the list, so the firm found out at intake, one matter at
 * a time, usually when somebody was trying to do something else.
 *
 * ## Leave balances are gone
 *
 * The prototype showed "9 days", "18 days". Nothing in this system records
 * leave, accrues it or deducts it, so the column was a number with no source —
 * and a leave balance that is wrong is worse than one that is absent, because
 * somebody books a holiday against it. It is not carried over, and the page
 * says so rather than leaving a reader to wonder where it went.
 */
export default async function StaffPage() {
  const roster = await runAs(
    Effect.flatMap(FirmService, (service) => service.roster()),
  );

  return (
    <>
      <h1 className="page-title">HR &amp; Staff Management</h1>
      <p className="page-subtitle">
        Who works here, what they are carrying, and whose practising certificate
        is current.
      </p>

      {/*
        The check is stated even when it passes.
        
        An empty section that simply vanishes is indistinguishable from a
        feature nobody built, and this is the page's reason for existing — a
        partner should be able to see that the question was asked and the answer
        was "nobody", rather than have to infer it from an absence.
      */}
      {roster.lapsed.length === 0 ? (
        <p className="dek" style={{ marginBottom: "var(--space-5)" }}>
          <i className="ph-duotone ph-check-circle ink-accent" aria-hidden />{" "}
          Every advocate at the firm holds a practising certificate for{" "}
          {String(roster.asAt.getUTCFullYear())}.
        </p>
      ) : null}

      {roster.lapsed.length > 0 ? (
        <section style={{ marginBottom: "var(--space-6)" }}>
          <SectionTitle>Practising certificates to renew</SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            These advocates hold no certificate for{" "}
            {String(roster.asAt.getUTCFullYear())}. They may not appear, and the
            system will refuse to assign them a matter that has to be filed.
          </p>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Advocate</th>
                  <th>Certificate</th>
                  <th>Open matters</th>
                </tr>
              </thead>
              <tbody>
                {roster.lapsed.map(({ advocate, openMatters }) => (
                  <tr key={advocate.id}>
                    <td className="cell-strong">{advocate.name}</td>
                    <td>
                      {advocate.practisingCertificate === undefined
                        ? "None on file"
                        : `${advocate.practisingCertificate.number} · ${String(
                            advocate.practisingCertificate.year,
                          )}`}
                    </td>
                    {/*
                      The number that makes this urgent rather than
                      administrative: work already assigned to somebody who
                      cannot currently appear on it.
                    */}
                    <td>{openMatters}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      ) : null}

      <SectionTitle spaced>Everybody</SectionTitle>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Open matters</th>
              <th>May appear</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {roster.staff.map(({ advocate, openMatters, mayAppear }) => (
              <tr key={advocate.id}>
                <td className="cell-strong">{advocate.name}</td>
                <td>
                  {advocate.role}
                  {advocate.practisingCertificate === undefined ? null : (
                    <div className="dek">
                      {advocate.practisingCertificate.number}
                    </div>
                  )}
                </td>
                <td>{openMatters}</td>
                <td>
                  {/*
                    Three answers, not two. A Finance Officer's "—" is not a
                    failed check: they are not an advocate, and showing "No"
                    would read as a problem with their certificate.
                  */}
                  {advocate.role !== "Advocate" &&
                  advocate.role !== "Managing Partner" ? (
                    <span className="dek">—</span>
                  ) : mayAppear ? (
                    <span className="tag tag-accent">Yes</span>
                  ) : (
                    <span className="tag tag-outline">Certificate lapsed</span>
                  )}
                </td>
                <td>
                  <span
                    className={
                      advocate.active ? "tag tag-accent" : "tag tag-neutral"
                    }
                  >
                    {advocate.active ? "Active" : "Left the firm"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <p className="dek" style={{ marginTop: "var(--space-5)" }}>
        Leave balances are not shown. Nothing in this system records leave,
        accrues it or deducts it &mdash; a balance with no source behind it is
        worse than none, because somebody books a holiday against it.
      </p>
    </>
  );
}
