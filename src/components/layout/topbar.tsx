"use client";

import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { MobileNav } from "./mobile-nav";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/playlists": "AI Playlists",
  "/staleness": "Song Staleness",
  "/social": "Social",
  "/settings": "Settings",
};

export function Topbar() {
  const pathname = usePathname();
  const title =
    Object.entries(pageTitles).find(([path]) =>
      pathname.startsWith(path)
    )?.[1] || "DataFlow";

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
      <MobileNav />
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  );
}
