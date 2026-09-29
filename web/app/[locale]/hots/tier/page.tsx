import { TierPage, tierMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => tierMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <TierPage locale={await pageLocale(props)} />;
}
