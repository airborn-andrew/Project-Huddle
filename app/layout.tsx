import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Huddle",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Huddle" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#5a5d62",
};

/** Applies a saved Dark choice before the first paint, so the page never flashes gray. */
const themeScript = `try{if(localStorage.getItem("huddle-theme")==="dark"){document.documentElement.dataset.theme="dark";document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#3a3a3d")}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
