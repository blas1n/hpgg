import { HotsShell, hotsMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => hotsMetadata(await pageLocale(props));

export default async function HotsLayout(props: LocaleProps & { children: React.ReactNode }) {
  return <HotsShell locale={await pageLocale(props)}>{props.children}</HotsShell>;
}
