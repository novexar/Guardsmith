// gen: 参照テンプレート。実 PJ では pnpm create vite で生成し、この構成・命名に合わせる。
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  // tanstackRouter は react より先に置く(src/routes/ からルートツリーを自動生成)
  plugins: [tanstackRouter({ target: "react" }), react(), tailwindcss()],
  resolve: {
    alias: { "@": "/src" },
  },
});
