/**
 * Where a request came from, as far as it can be known.
 *
 * Used to key the authentication rate limits, which makes "as far as it can be
 * known" the whole of the problem: a limiter keyed on something the caller
 * controls is a limiter the caller can step around by changing a header.
 *
 * ## The order is not arbitrary
 *
 * `x-real-ip` first. Vercel sets it to the address the edge saw and **replaces**
 * whatever arrived, so it cannot be forged from outside — a client that sends
 * its own `x-real-ip` has it overwritten before the function is invoked.
 *
 * `x-forwarded-for` second, and only its first entry. The header is a *list*
 * that each hop appends to, so a request arriving with a fabricated
 * `x-forwarded-for: 1.2.3.4` reaches the function as `1.2.3.4, <real address>`.
 * The first entry is the conventional "client address" and is exactly the part
 * an attacker can write; it is used here only because behind Vercel the header
 * is rewritten rather than appended to, and it is second in the order because
 * that is the weaker guarantee.
 *
 * Reading these two in this order is therefore a statement about the deployment
 * (D-1: one firm, on Vercel) rather than a general-purpose IP resolver. Behind a
 * different proxy the same code would need a different rule, which is why the
 * reasoning is here and not assumed.
 *
 * ## When there is nothing to read
 *
 * Locally, and in tests, neither header exists. The answer is then a single
 * shared name rather than no key at all, so an unattributable request still
 * spends from *something*. The alternative — no source, no limit — would make
 * the control depend on a header being present, which is a bypass that arrives
 * the first time somebody deploys behind a proxy that strips them.
 */
export const sourceOf = (headers: Headers): string => {
  const real = headers.get("x-real-ip")?.trim();
  if (real !== undefined && real !== "") return real;

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded !== undefined && forwarded !== "") return forwarded;

  return "unattributed";
};
