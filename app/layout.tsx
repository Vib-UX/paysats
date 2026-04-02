import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Paysats — Lightning to IDR",
  description: "Pay with Lightning, receive IDR to your bank or e-wallet. Built for merchants and spenders.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Paysats",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0A0A"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-white antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
