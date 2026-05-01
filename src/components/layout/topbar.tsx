"use client";

import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";

const pageTitles: Record<string, string> = {
  "/dashboard": "Home",
  "/discover":  "Insights",
  "/playlists": "AI Playlists",
  "/staleness": "Ear Health",
  "/social":    "Social",
  "/settings":  "Settings",
  "/mystery":   "Mystery Box",
  "/wrapped":   "Wrapped",
};

export function Topbar() {
  const pathname = usePathname();
  const title = Object.entries(pageTitles).find(([p]) => pathname.startsWith(p))?.[1] ?? "DataFlow";

  return (
    <header className="glass-topbar sticky top-0 z-40 flex h-14 items-center gap-3 px-4 md:px-6">
      {/* Page title — only visible on mobile where sidebar is hidden */}
      <span className="text-sm font-semibold md:hidden">{title}</span>

      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  );
}
