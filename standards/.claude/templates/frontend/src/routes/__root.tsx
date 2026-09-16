// gen: 参照テンプレート(全画面共通レイアウト)。実 PJ では scaffold 後にこの構成・命名に合わせる。
// shadcn Sidebar + コマンドパレットを全画面で共有する。装飾は足さない(DESIGN.md)。
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 p-4">
        <Outlet />
      </main>
      <CommandPalette />
    </SidebarProvider>
  );
}
