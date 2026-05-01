"use client";

import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { MobileNav } from "./mobile-nav";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/discover":  "Discover",
  "/wrapped":   "Wrapped",
  "/mystery":   "Mystery Box",
  "/playlists": "AI Playlists",
  "/staleness": "Staleness",
  "/social":    "Social",
  "/settings":  "Settings",
};

export function Topbar() {
  const pathname = usePathname();
  const title = Object.entries(pageTitles).find(([p]) => pathname.startsWith(p))?.[1] ?? "DataFlow";

  return (
    <header className="glass-topbar sticky top-0 z-40 flex h-14 items-center gap-3 px-4 md:px-6">
      <MobileNav />

      {/* Page title — only visible on mobile where sidebar is hidden */}
      <span className="text-sm font-semibold md:hidden">{title}</span>

      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  );
}
