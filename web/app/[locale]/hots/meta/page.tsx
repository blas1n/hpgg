import { WeeklyPage, weeklyMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => weeklyMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <WeeklyPage locale={await pageLocale(props)} />;
}
