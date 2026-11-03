import AgricultureWorkbench from "@/components/agriculture/AgricultureWorkbench";

export const metadata = {
  title: "Agriculture · NISAR SME2 soil moisture | Beyonders",
  description: "Explore dated NISAR SME2 PROVISIONAL soil-moisture observations with quality screening, uncertainty and provenance.",
};

export default function AgriculturePage() {
  return <AgricultureWorkbench />;
}
