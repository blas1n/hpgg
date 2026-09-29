import { MapsPage, mapsMetadata } from "@/routes/pages";

export const metadata = mapsMetadata("ko");

export default function Page() {
  return <MapsPage locale="ko" />;
}
