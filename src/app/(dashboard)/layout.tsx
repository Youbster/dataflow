import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MiniPlayer } from "@/components/layout/mini-player";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="md:ml-60 flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 p-4 md:p-6 lg:p-8 pb-32 md:pb-24">{children}</main>
      </div>
      <MiniPlayer />
      <MobileNav />
    </div>
  );
}
