// 各テストファイルの前に DB のテーブルを作る。外へのメール送信(Resend)は横取りして、実際には送らない
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, vi } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const realFetch = globalThis.fetch;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.resend.com/")) return Promise.resolve(Response.json({ id: "test" }));
    return realFetch(input, init);
  });
});
