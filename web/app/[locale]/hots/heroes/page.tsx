import { HeroesPage, heroesMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => heroesMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <HeroesPage locale={await pageLocale(props)} />;
}
