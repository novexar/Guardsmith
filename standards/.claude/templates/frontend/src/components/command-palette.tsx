// gen: 参照テンプレート(cmdk コマンドパレット・Cmd/Ctrl+K)。実 PJ では
// 作成系アクション・検索・画面遷移をここに集約する(FRONTEND_STANDARDS.md)。
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CommandDialog, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="コマンドまたは検索..." />
      <CommandList>
        {/* gen: 作成系アクション・検索・画面遷移を PJ に合わせて追加する */}
        <CommandItem onSelect={() => void navigate({ to: "/" })}>ダッシュボードへ移動</CommandItem>
      </CommandList>
    </CommandDialog>
  );
}
