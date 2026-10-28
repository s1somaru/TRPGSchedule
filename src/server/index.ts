// Worker の入口。画像・JS・CSS 以外(画面のページと /api)がここに届く(wrangler.jsonc の run_worker_first)
import { Hono } from "hono";
import { runDailyCleanup } from "./cron";
import { Errors, handleError } from "./errors";
import { calendars } from "./routes/calendars";
import { feedback } from "./routes/feedback";
import { sessions } from "./routes/sessions";
import { pageAsset, sessionPage } from "./share-card";
import { httpsOnly, securityHeaders, sizeLimit, writeGuard } from "./security";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// http で来たら https に飛ばす(ページも API も)
app.use("*", httpsOnly);

app.use("/api/*", securityHeaders, writeGuard, sizeLimit);
app.route("/api/calendars", calendars);
app.route("/api/sessions", sessions);
app.route("/api/feedback", feedback);

// 卓ページ:URLを貼ったときのカードに卓のタイトルを入れる。それ以外の /s/ は、ふつうの画面のファイルを返す
app.get("/s/:id", sessionPage);
app.get("/s/*", sessionPage);

// 知らない API は 404 の JSON(下の「ほかの画面」に流さない)
app.all("/api/*", () => {
  throw Errors.notFound();
});

// ほかの画面(トップ・自分のカレンダー・卓を作る・規約など)は、画面のファイルをそのまま返す
app.get("*", pageAsset);

app.notFound((c) => handleError(Errors.notFound(), c));
app.onError(handleError);

export default {
  fetch: app.fetch,
  // 毎日1回の定期処理(wrangler.jsonc の triggers で時刻を決める)
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runDailyCleanup(env.DB, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
