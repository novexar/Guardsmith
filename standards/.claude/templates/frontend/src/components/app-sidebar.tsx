// gen: 参照テンプレート(shadcn Sidebar・折りたたみ対応)。実 PJ では
// `pnpm dlx shadcn@latest add sidebar` で ui/sidebar を導入し、メニュー項目を PJ の画面に合わせる。
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// gen: PJ の画面構成に合わせて置き換える(命名: { title, to, icon } の配列)
const items = [
  { title: "ダッシュボード", to: "/", icon: LayoutDashboard },
  { title: "設定", to: "/settings", icon: Settings },
];

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton asChild>
                <Link to={item.to}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  );
}
