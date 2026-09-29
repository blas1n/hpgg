import { TierPage, tierMetadata } from "@/routes/pages";

export const metadata = tierMetadata("ko");

export default function Page() {
  return <TierPage locale="ko" />;
}
