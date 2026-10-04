import { WeeklyPage, weeklyMetadata, weekParams } from "@/routes/pages";
import { pageLocale, type WeekProps } from "@/routes/params";

export const dynamicParams = false;
export const generateStaticParams = weekParams;
export const generateMetadata = async (props: WeekProps) => weeklyMetadata(await pageLocale(props), (await props.params).week);

export default async function Page(props: WeekProps) {
  return <WeeklyPage locale={await pageLocale(props)} week={(await props.params).week} />;
}
