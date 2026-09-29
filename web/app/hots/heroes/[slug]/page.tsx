import { HeroPage, heroMetadata, heroParams } from "@/routes/pages";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = heroParams;
export const generateMetadata = (props: Props) => heroMetadata("ko", props);

export default function Page(props: Props) {
  return <HeroPage locale="ko" {...props} />;
}
