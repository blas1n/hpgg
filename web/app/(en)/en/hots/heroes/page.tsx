import { HeroesPage, heroesMetadata } from "@/routes/pages";

export const metadata = heroesMetadata("en");

export default function Page() {
  return <HeroesPage locale="en" />;
}
