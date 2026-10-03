import { PatchesPage, patchesMetadata } from "@/routes/pages";
import { pageLocale, type LocaleProps } from "@/routes/params";

export const generateMetadata = async (props: LocaleProps) => patchesMetadata(await pageLocale(props));

export default async function Page(props: LocaleProps) {
  return <PatchesPage locale={await pageLocale(props)} />;
}
