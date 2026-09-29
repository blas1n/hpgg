import { PlayersPage, playersMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => playersMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <PlayersPage locale={await pageLocale(props)} />;
}
