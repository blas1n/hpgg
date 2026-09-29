import { PlayersPage, playersMetadata } from "@/routes/pages";

export const metadata = playersMetadata("ko");

export default function Page() {
  return <PlayersPage locale="ko" />;
}
