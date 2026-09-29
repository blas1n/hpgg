import { PlayersPage, playersMetadata } from "@/routes/pages";

export const metadata = playersMetadata("en");

export default function Page() {
  return <PlayersPage locale="en" />;
}
