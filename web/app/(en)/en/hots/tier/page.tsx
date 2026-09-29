import { TierPage, tierMetadata } from "@/routes/pages";

export const metadata = tierMetadata("en");

export default function Page() {
  return <TierPage locale="en" />;
}
