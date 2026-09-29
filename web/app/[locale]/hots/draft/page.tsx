import { DraftPage, draftMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => draftMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <DraftPage locale={await pageLocale(props)} />;
}
