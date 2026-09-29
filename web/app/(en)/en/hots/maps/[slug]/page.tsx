import { MapPage, mapMetadata, mapParams } from "@/routes/pages";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export const generateStaticParams = mapParams;
export const generateMetadata = (props: Props) => mapMetadata("en", props);

export default function Page(props: Props) {
  return <MapPage locale="en" {...props} />;
}
