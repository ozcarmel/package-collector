import type { Metadata, Viewport } from "next";
import "./globals.css";

const publicBasePath = process.env.GITHUB_PAGES === "true" ? "/package-collector" : "";

export const metadata: Metadata = {
  title: "חבילות להב",
  description: "ניהול איסוף ומסירת חבילות בקיבוץ להב",
  manifest: `${publicBasePath}/manifest.json`,
  icons: {
    icon: `${publicBasePath}/icon.svg`,
    shortcut: `${publicBasePath}/icon.svg`,
    apple: `${publicBasePath}/icon-180.png`,
  },
  appleWebApp: {
    capable: true,
    title: "חבילות להב",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#276749",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

