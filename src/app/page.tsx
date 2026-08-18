import { redirect } from "next/navigation";

/** The system has no marketing front door; staff land on the dashboard. */
export default function Home() {
  redirect("/dashboard");
}
