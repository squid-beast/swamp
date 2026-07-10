import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "SWAMP — yeet data in, UI comes out",
  description:
    "yeet a webhook, JSON, CSV, or spreadsheet into SWAMP. it types every column, builds a field registry, spawns the views, and hands you a clean UI. no schema. no cap.",
};

export default function LandingPage() {
  return <Landing />;
}
