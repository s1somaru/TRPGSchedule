import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

// テストは Workers と同じ環境で動かす。DB のテーブルは migrations/ から作る
// お問い合わせの通知(src/server/notify.ts)の secret はテスト用の値を入れ、送信は test/setup.ts で横取りする
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            RESEND_API_KEY: "re_test_key",
            NOTIFY_EMAIL: "owner@example.com",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
