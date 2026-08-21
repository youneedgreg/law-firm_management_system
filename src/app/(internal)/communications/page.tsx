import Link from "next/link";
import { Effect, Option } from "effect";
import { Empty, PageHead, SectionTitle, TableWrap } from "@/components/ui";
import { may } from "@/domain/identity/permissions";
import { runAs, signedIn } from "@/runtime/session";
import { LibraryService } from "@/services/library-service";
import { LogContactForm } from "./LogContactForm";

/**
 * The contact log: conversations that happened outside this system.
 *
 * ## This is not the message thread, and the difference matters
 *
 * `/portal/messages` and the correspondence panel on a client's file hold
 * messages sent *through* this system — text somebody typed into it, delivered
 * by it, reproducible verbatim, and editable by nobody. That is evidence.
 *
 * This is a note *about* a phone call, a meeting, an email sent from Outlook:
 * somebody's summary, written afterwards, of something the system never saw.
 * That is testimony, and it is why the two are separate tables with different
 * rules — the contact log has no append-only trigger, because a summary written
 * from memory is exactly the kind of thing that should be correctable.
 *
 * The seed refuses to import one as the other for the same reason.
 *
 * ## The list at the top is what a log is for
 *
 * Not what happened — what has *not*. A chronological feed cannot show you the
 * client nobody has rung since March, because the absence of an entry is
 * invisible in a list of entries.
 */
export default async function CommunicationsPage() {
  const principal = await signedIn();
  const mayLog = may(principal, "client:write");

  const [log, quiet, choices] = await runAs(
    Effect.all(
      [
        Effect.flatMap(LibraryService, (service) => service.log()),
        Effect.flatMap(LibraryService, (service) => service.neglected()),
        mayLog
          ? Effect.flatMap(LibraryService, (service) => service.choices())
          : Effect.succeed(undefined),
      ],
      { concurrency: "unbounded" },
    ),
  );

  return (
    <>
      <PageHead title="Communications">
        {choices === undefined ? null : (
          <LogContactForm clients={choices.clients} matters={choices.matters} />
        )}
      </PageHead>
      <p className="page-subtitle">
        Calls, meetings, emails and messages that happened outside this system,
        recorded against the client they concerned. Messages sent{" "}
        <em>through</em> OKLaw live on the client&rsquo;s file &mdash; those are
        reproducible verbatim, and these are somebody&rsquo;s summary.
      </p>

      {quiet.length > 0 ? (
        <section style={{ marginBottom: "var(--space-6)" }}>
          <SectionTitle>Nobody has been in touch</SectionTitle>
          <p className="dek" style={{ marginBottom: "var(--space-2)" }}>
            Clients with open matters and no contact logged in the last month.
            The one thing a chronological log cannot show you.
          </p>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Open matters</th>
                  <th>Last contact</th>
                </tr>
              </thead>
              <tbody>
                {quiet.map((row) => (
                  <tr key={row.clientId}>
                    <td className="cell-strong">
                      <Link href={`/clients/${row.clientId}`}>
                        {row.clientName}
                      </Link>
                    </td>
                    <td>{row.openMatters}</td>
                    <td>
                      {/*
                        "Never" is not a very old date. A client the firm has
                        never spoken to wants a different reaction from one it
                        spoke to in March, and the Option is what keeps the two
                        distinguishable all the way to the screen.
                      */}
                      {Option.isNone(row.lastContact) ? (
                        <span className="tag tag-accent-2">Never</span>
                      ) : (
                        <>
                          {row.lastContact.value.toLocaleDateString("en-KE")}
                          <div className="dek">
                            {String(Option.getOrElse(row.days, () => 0))} days
                            ago
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      ) : null}

      <SectionTitle spaced>The log</SectionTitle>
      {log.length === 0 ? (
        <Empty>Nothing has been logged yet.</Empty>
      ) : (
        log.map(({ contact, clientName, matterNumber, loggedByName }) => (
          <div className="row row-icon" key={contact.id}>
            <i
              className={`${CHANNEL_ICON[contact.channel]} ${
                contact.direction === "Incoming" ? "ink-accent" : ""
              }`}
              aria-hidden
            />
            <div>
              <div style={{ fontSize: 14 }}>
                <strong>{contact.channel}</strong>{" "}
                {contact.direction === "Incoming" ? "from" : "to"} {clientName}
                {Option.isSome(matterNumber) ? (
                  <span className="dek"> · {matterNumber.value}</span>
                ) : null}
              </div>
              <div className="row-meta">
                {contact.summary} ·{" "}
                {contact.occurredOn.toLocaleDateString("en-KE")} · logged by{" "}
                {loggedByName}
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}

/** The glyph follows the channel, so the log stays scannable down the rail. */
const CHANNEL_ICON: Readonly<Record<string, string>> = {
  Email: "ph-duotone ph-envelope",
  WhatsApp: "ph-duotone ph-whatsapp-logo",
  Call: "ph-duotone ph-phone",
  Meeting: "ph-duotone ph-users-three",
  SMS: "ph-duotone ph-chat-teardrop-text",
};
