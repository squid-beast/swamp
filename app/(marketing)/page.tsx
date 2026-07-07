import type { Metadata } from "next";
import { Landing } from "@/components/landing";

export const metadata: Metadata = {
  title: "SWAMP — dump any data, get a UI",
  description:
    "Dump a webhook, JSON, CSV, or spreadsheet into SWAMP. It infers semantic types, builds a field registry, recommends views, and renders the UI from metadata alone.",
};

export default function LandingPage() {
  return <Landing />;
}
