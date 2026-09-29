import { RootRedirect } from "@/routes/root";

/** hpgg.win root: one game so far — forward to /hots/. */
export default function Root() {
  return <RootRedirect locale="ko" />;
}
