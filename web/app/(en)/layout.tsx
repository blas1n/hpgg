import { RootDocument, rootMetadata, rootViewport } from "@/routes/root";

// English pages (#10): the same pages as the Korean ones, pre-rendered under /en with <html lang="en">
export const metadata = rootMetadata("en");
export const viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument locale="en">{children}</RootDocument>;
}
