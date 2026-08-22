import { SegmentSkeleton } from "@/components/Skeleton";

/**
 * The matter file, while it is being read.
 *
 * This sits on `[id]` rather than on `cases/`, and the segment above it now
 * has no loading state at all — deliberately, because `/cases` waits for
 * nothing. Its rows are an atom, so the page renders immediately and the table
 * says it is reading; the only thing it awaits is `searchParams`. A
 * `loading.tsx` there would be a file claiming to cover a wait that does not
 * happen, and a `loading.tsx` on the parent covers the whole subtree, so the
 * one that used to be there was answering for this page under the wrong name.
 */
export default function Loading() {
  return <SegmentSkeleton shape="detail" />;
}
