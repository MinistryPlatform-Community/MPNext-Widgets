import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * No `icons` entry: `src/app/favicon.ico` is the App Router file convention,
 * and Next.js emits the `<link rel="icon">` for it automatically. Naming a
 * path here instead is how this app ended up advertising
 * `/assets/icons/favicon.ico`, which nothing ever served (TODO 26).
 */
export const metadata: Metadata = {
  title: "MPNext Widgets",
  description: "Ministry Platform Embed Widget Components",
};

export const viewport: Viewport = {
  themeColor: "#000000",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {


  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
