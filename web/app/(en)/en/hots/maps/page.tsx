import { MapsPage, mapsMetadata } from "@/routes/pages";

export const metadata = mapsMetadata("en");

export default function Page() {
  return <MapsPage locale="en" />;
}
