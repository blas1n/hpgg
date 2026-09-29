import { MapPage, mapMetadata, mapParams } from "@/routes/pages";
import { pageLocale, type SlugProps } from "@/routes/params";

export const dynamicParams = false;
export const generateStaticParams = mapParams;
export const generateMetadata = async (props: SlugProps) => mapMetadata(await pageLocale(props), props);

export default async function Page(props: SlugProps) {
  return <MapPage locale={await pageLocale(props)} {...props} />;
}
