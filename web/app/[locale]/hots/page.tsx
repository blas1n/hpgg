import { HomePage, homeMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => homeMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <HomePage locale={await pageLocale(props)} />;
}
