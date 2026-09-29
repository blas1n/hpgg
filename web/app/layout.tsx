import { RootDocument, rootMetadata, rootViewport } from "@/routes/root";

export const metadata = rootMetadata("ko");
export const viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="ko">{children}</RootDocument>;
}
