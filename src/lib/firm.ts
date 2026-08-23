/**
 * The firm this installation serves, as the screens need it (D-12).
 *
 * In `lib/` rather than beside the config that produces it, because both ends
 * need it and they are on opposite sides of the application: `infra/config.ts`
 * reads it from the environment, and the masthead — a client component —
 * renders it. A client component that imported `infra/` would pull Effect's
 * config machinery into the browser bundle to describe three strings.
 *
 * Three fields, and they are not interchangeable:
 *
 * - `name` is the full legal name, as it would appear on a letterhead. It goes
 *   where the firm is being *named* to somebody: the page description, the
 *   sentence in the portal telling a client whose correspondence this is.
 * - `shortName` is the wordmark. It goes in the masthead, beside a tagline and
 *   a search box, and around a dozen characters fit.
 * - `tagline` is the line beside the wordmark — where they are and what they
 *   do. "Nairobi · General Practice".
 *
 * A single `name` used for all three would put "Kimani, Otieno & Partners
 * Advocates" through a masthead sized for five characters, and the failure
 * would be a layout that looks broken rather than an error anybody could act
 * on.
 */
export interface Firm {
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
}
