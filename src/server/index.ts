// Worker の入口。/api だけがここに届く(画面のファイルは Cloudflare が直接返す)
import { Hono } from "hono";
import { runDailyCleanup } from "./cron";
import { Errors, handleError } from "./errors";
import { calendars } from "./routes/calendars";
import { feedback } from "./routes/feedback";
import { sessions } from "./routes/sessions";
import { securityHeaders, sizeLimit, writeGuard } from "./security";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("/api/*", securityHeaders, writeGuard, sizeLimit);
app.route("/api/calendars", calendars);
app.route("/api/sessions", sessions);
app.route("/api/feedback", feedback);

app.notFound((c) => handleError(Errors.notFound(), c));
app.onError(handleError);

export default {
  fetch: app.fetch,
  // 毎日1回の定期処理(wrangler.jsonc の triggers で時刻を決める)
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runDailyCleanup(env.DB, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
