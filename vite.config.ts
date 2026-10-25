import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// 画面のファイルを dist/client に作る。public/ の中身(_headers など)もそこへコピーされる
export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  plugins: [preact()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
