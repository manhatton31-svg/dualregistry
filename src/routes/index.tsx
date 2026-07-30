import { createFileRoute } from "@tanstack/react-router";
import { DashboardApp } from "@/components/dashboard/dashboard-app";

export const Route = createFileRoute("/")({
  component: () => <DashboardApp />,
});
