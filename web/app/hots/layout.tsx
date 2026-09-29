import { HotsShell, hotsMetadata } from "@/routes/pages";

export const metadata = hotsMetadata("ko");

export default function HotsLayout({ children }: { children: React.ReactNode }) {
  return <HotsShell locale="ko">{children}</HotsShell>;
}
