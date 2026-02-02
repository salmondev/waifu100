import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import "./globals.css";

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["latin", "thai"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "100 Favorite Characters Challenge | Waifu100",
  description: "Create your own 100 favorite anime and game characters grid. Search, select, and export your personalized character collection as an image.",
  keywords: ["anime", "characters", "waifu", "challenge", "grid", "100 characters"],
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sarabun.variable} font-sans antialiased`}
        style={{ fontFamily: 'var(--font-sarabun), sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
