import { PrivacyPage, privacyMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => privacyMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <PrivacyPage locale={await pageLocale(props)} />;
}
