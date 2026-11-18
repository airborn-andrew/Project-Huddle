import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Huddle for OHI",
  manifest: "/ohi.webmanifest",
};

export default function OhiLayout({ children }: { children: React.ReactNode }) {
  return children;
}
