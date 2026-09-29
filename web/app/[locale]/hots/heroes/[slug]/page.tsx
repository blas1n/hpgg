import { HeroPage, heroMetadata, heroParams } from "@/routes/pages";
import { pageLocale, type SlugProps } from "@/routes/params";

export const dynamicParams = false;
export const generateStaticParams = heroParams;
export const generateMetadata = async (props: SlugProps) => heroMetadata(await pageLocale(props), props);

export default async function Page(props: SlugProps) {
  return <HeroPage locale={await pageLocale(props)} {...props} />;
}
