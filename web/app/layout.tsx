import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "@/styles/globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hpgg.win"),
  title: { default: "hpgg.win · Happy Good Game", template: "%s | HPGG" },
  description: "매치 데이터로 보는 게임 메타 통계. 공식을 숨기지 않습니다.",
  icons: { icon: "/img/brand/icon-sm.png", apple: "/img/brand/icon.png" },
  openGraph: { siteName: "hpgg.win", locale: "ko_KR", type: "website", images: ["/img/brand/logo-h.png"] },
};

export const viewport: Viewport = { themeColor: "#0e1118", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the init script sets data-theme before paint (light theme, #1): React must keep what it finds there
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        {children}
        <Script data-goatcounter="https://hpgg.goatcounter.com/count" src="https://gc.zgo.at/count.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
