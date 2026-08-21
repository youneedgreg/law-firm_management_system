import { Schema } from "effect";
import { AdvocateId, CaseId, ClientId, ContactId } from "../shared/ids";

/**
 * The contact log: what was said to a client outside the system.
 *
 * ## Why this is not the message thread
 *
 * `domain/message` is correspondence *through* this system — text somebody
 * typed into it, which it delivered and can produce verbatim. This is a
 * **note about a conversation that happened elsewhere**: a phone call, a
 * meeting, a WhatsApp message, an email sent from Outlook. The distinction
 * matters and is the reason the seed refuses to import one as the other.
 *
 * A message is *evidence*: the system has the words, both sides saw the same
 * ones, and neither can change them. A contact-log entry is *testimony*:
 * somebody's summary, written afterwards, of something the system never saw. A
 * firm that conflates the two ends up producing "Discussed plea strategy" as
 * though it were a document sent to the client.
 *
 * So this module is deliberately weaker than `message`. Entries are attributed
 * and dated, and they can be corrected — because a summary somebody wrote from
 * memory is exactly the kind of thing that *should* be correctable, and
 * pretending otherwise would give a note the weight of a record.
 */

export const CHANNELS = [
  "Email",
  "WhatsApp",
  "Call",
  "Meeting",
  "SMS",
] as const;

export const Channel = Schema.Literal(...CHANNELS);
export type Channel = typeof Channel.Type;

/**
 * Which way it went.
 *
 * The prototype did not record this, and it is the first question anybody asks
 * of a contact log: did we chase them, or did they chase us? A log that cannot
 * answer it is a list of events rather than a record of a relationship.
 */
export const DIRECTIONS = ["Outgoing", "Incoming"] as const;

export const Direction = Schema.Literal(...DIRECTIONS);
export type Direction = typeof Direction.Type;

export const Contact = Schema.Struct({
  id: ContactId,
  clientId: ClientId,
  /** The matter it concerned, where it concerned one. */
  caseId: Schema.Option(CaseId),
  channel: Channel,
  direction: Direction,
  /** Who at the firm was on the call, or sent it. */
  loggedBy: AdvocateId,
  /**
   * What was discussed, agreed or sent — in somebody's own words.
   *
   * Deliberately a summary and not a transcript. A field that invited a
   * verbatim record would produce approximate quotations, which are worse than
   * an honest paraphrase because they read as exact.
   */
  summary: Schema.NonEmptyTrimmedString,
  occurredOn: Schema.DateFromSelf,
});

export type Contact = typeof Contact.Type;

/** Most recent first, which is how a log is read. */
export const mostRecent = (contacts: readonly Contact[]): readonly Contact[] =>
  [...contacts].sort((a, b) => b.occurredOn.getTime() - a.occurredOn.getTime());

/**
 * When the firm last had any contact with this client.
 *
 * The figure a partner uses to find the clients nobody has spoken to. Counts
 * both directions: a client who called last week has been in touch, whoever
 * picked up the telephone.
 */
export const lastContact = (contacts: readonly Contact[]): Date | undefined =>
  mostRecent(contacts)[0]?.occurredOn;

export class LoggedInTheFuture extends Schema.TaggedError<LoggedInTheFuture>()(
  "LoggedInTheFuture",
  { occurredOn: Schema.Date },
) {
  get reason(): string {
    return (
      `a contact cannot be logged for ${this.occurredOn.toISOString().slice(0, 10)}, ` +
      `which has not happened yet — this log records conversations that took ` +
      `place, and a future date is an appointment`
    );
  }
}
