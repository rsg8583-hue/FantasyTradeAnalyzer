import type { Metadata } from "next";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = { title: "Dashboard · Fantasy Trade Analyzer" };

export default function DashboardPage() {
  return <Dashboard />;
}
