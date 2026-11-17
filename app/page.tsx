import { notFound } from "next/navigation";

/** Projects are only reached through their own link. */
export default function Home() {
  notFound();
}
