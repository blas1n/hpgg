import { MapsPage, mapsMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => mapsMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <MapsPage locale={await pageLocale(props)} />;
}
