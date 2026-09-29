import { HomePage, homeMetadata } from "@/routes/pages";

export const metadata = homeMetadata("ko");

export default function Page() {
  return <HomePage locale="ko" />;
}
