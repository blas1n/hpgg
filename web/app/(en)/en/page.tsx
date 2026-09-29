import { RootRedirect } from "@/routes/root";

/** hpgg.win/en/: one game so far — forward to /en/hots/. */
export default function Root() {
  return <RootRedirect locale="en" />;
}
