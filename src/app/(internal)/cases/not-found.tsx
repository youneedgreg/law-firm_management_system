import { NotOnFile } from "@/components/ui";

/**
 * Reached when `notFound()` is called for a matter — either the id names no
 * row, or it is not a well-formed id at all. Both are the same answer to the
 * person reading: there is no such file.
 */
export default function CaseNotFound() {
  return (
    <NotOnFile backHref="/cases" backLabel="Back to cases">
      No matter with that reference is on file. It may have been closed and
      archived, or the link may be out of date.
    </NotOnFile>
  );
}
