import { pageLocale, type LocaleProps } from "@/routes/params";
import { RootRedirect } from "@/routes/root";

/** /<locale>/: one game so far — forward to /<locale>/hots/. */
export default async function Page(props: LocaleProps) {
  return <RootRedirect locale={await pageLocale(props)} />;
}
