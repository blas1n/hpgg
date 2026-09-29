import { RootDocument, rootMetadata, rootViewport } from "@/routes/root";

// Korean pages, the default: the live URLs (/, /hots/…) with <html lang="ko">
export const metadata = rootMetadata("ko");
export const viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="ko">{children}</RootDocument>;
}
