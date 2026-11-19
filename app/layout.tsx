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
  themeColor: "#3c3e42",
};

/** Applies a saved Dark choice before the first paint, so the page never flashes gray. */
const themeScript = `try{if(localStorage.getItem("huddle-theme")==="dark"){document.documentElement.dataset.theme="dark";document.querySelector('meta[name="theme-color"]')?.setAttribute("content","#1c1c1e")}}catch(e){}`;

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
