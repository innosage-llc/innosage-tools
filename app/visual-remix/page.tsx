import type { Metadata } from "next";
import VisualRemixApp from "./VisualRemixApp";

export const metadata: Metadata = {
  title: "Visual Remix — Editable Image Remakes | InnoSage DevTools",
  description:
    "Rebuild a flattened image with your chosen vision agent, review editable scene proposals, and export reusable projects and 1080×1440 PNGs locally.",
  alternates: { canonical: "https://innosage.co/tools/visual-remix" },
};
export default function VisualRemixPage() {
  return <VisualRemixApp />;
}
