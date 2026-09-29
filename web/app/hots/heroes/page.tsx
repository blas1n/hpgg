import { HeroesPage, heroesMetadata } from "@/routes/pages";

export const metadata = heroesMetadata("ko");

export default function Page() {
  return <HeroesPage locale="ko" />;
}
