import { HotsShell, hotsMetadata } from "@/routes/pages";

export const metadata = hotsMetadata("en");

export default function HotsLayout({ children }: { children: React.ReactNode }) {
  return <HotsShell locale="en">{children}</HotsShell>;
}
