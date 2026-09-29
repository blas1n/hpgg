import { HomePage, homeMetadata } from "@/routes/pages";

export const metadata = homeMetadata("en");

export default function Page() {
  return <HomePage locale="en" />;
}
