import { Passcode } from "@/components/passcode";

export default function OhiUnlockPage() {
  return <Passcode title="OHI" endpoint="/api/ohi/unlock" home="/ohi" />;
}
