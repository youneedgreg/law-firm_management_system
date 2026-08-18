import { InternalShell } from "@/components/InternalShell";

// A route group adds no URL segment, so this layout sits at "/" alongside the
// root layout and nests inside it, wrapping every staff-facing route.
export default function InternalLayout({ children }: LayoutProps<"/">) {
  return <InternalShell>{children}</InternalShell>;
}
