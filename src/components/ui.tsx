import Link from "next/link";

/**
 * Small presentational building blocks shared by the screens. They are server
 * components — nothing here holds state — so pages stay on the server unless
 * they genuinely need interactivity.
 */

export function PageHead({
  title,
  children,
}: {
  title: string;
  /** Right-hand action, e.g. a "New case" button. */
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  spaced = false,
}: {
  children: React.ReactNode;
  /** Adds top margin when the heading follows another block. */
  spaced?: boolean;
}) {
  return (
    <h2
      className={
        spaced ? "section-title section-title-spaced" : "section-title"
      }
    >
      {children}
    </h2>
  );
}

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="back-link">
      &larr; {children}
    </Link>
  );
}

export function Stat({
  label,
  value,
  tone = "ink",
  small = false,
}: {
  label: string;
  value: string | number;
  tone?: "ink" | "accent" | "accent-2";
  small?: boolean;
}) {
  const toneClass =
    tone === "accent"
      ? " ink-accent"
      : tone === "accent-2"
        ? " ink-accent-2"
        : "";
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={`stat-value${small ? " stat-value-sm" : ""}${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

/** Wide tables scroll inside their own box rather than the page. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="dek">{children}</p>;
}

/** Shown when a detail route is asked for a record the firm has no file on. */
export function NotOnFile({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <BackLink href={backHref}>{backLabel}</BackLink>
      <div className="no-access">
        <i className="ph-duotone ph-file-x" aria-hidden />
        <h1 className="detail-title">Not on file</h1>
        <p className="dek">{children}</p>
      </div>
    </>
  );
}
