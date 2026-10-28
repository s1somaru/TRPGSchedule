// 卓ページの HTML に、URLを貼ったときのカード(OGP)用の卓のタイトルを入れる(spec.md 3.21)
// - Discord・LINE・X などがURLを読みに来たとき、「たくよせ(卓のタイトル)」と出るようにする
// - 入れるのはタイトルだけ。候補日や参加者は入れない(卓URLを知っている人は、どのみち卓ページで見られる)
// - うまくいかないとき(卓がない・回数制限・DBの失敗)は、ふつうの HTML をそのまま返す
import type { Context } from "hono";
import { ID_PATTERNS } from "../shared/ids";
import { rateLimitKey } from "./ratelimit";
import type { AppEnv } from "./types";

const SITE = "たくよせ";

/**
 * 画面のファイルに付けるセキュリティヘッダ。public/_headers と同じ内容にしておく
 * (Worker が返す HTML には _headers が効かないため、ここで付ける)
 */
export const PAGE_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** カードに出す文字 */
export function shareText(title: string): { title: string; description: string } {
  return {
    title: `${SITE}（${title}）`,
    description: `「${title}」の日程調整です。空いている日に ◯△× を入れてください。登録なしで使えます。`,
  };
}

async function findTitle(c: Context<AppEnv>, id: string): Promise<string | null> {
  if (!ID_PATTERNS.session.test(id)) return null;
  // 読み込みと同じ回数制限。超えたら、タイトルなしのふつうの HTML にする
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.RL_READ.limit({ key: rateLimitKey(ip) });
  if (!success) return null;
  const row = await c.env.DB.prepare("SELECT title FROM sessions WHERE id = ?1").bind(id).first<{ title: string }>();
  return row?.title ?? null;
}

/**
 * 画面のファイル(トップ・自分のカレンダーなど)を返す。
 * Worker を通したファイルには public/_headers が効かないので、同じヘッダをここで付ける
 */
export async function pageAsset(c: Context<AppEnv>): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(asset.headers);
  for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) headers.set(k, v);
  return new Response(asset.body, { status: asset.status, headers });
}

/** 卓ページ(/s/:id)の HTML を返す */
export async function sessionPage(c: Context<AppEnv>): Promise<Response> {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(asset.headers);
  for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) headers.set(k, v);
  // 卓のタイトルは変わることがあるので、毎回確かめてもらう
  headers.set("Cache-Control", "no-cache");
  const plain = () => new Response(asset.body, { status: asset.status, headers });

  if (!asset.ok || !(asset.headers.get("Content-Type") ?? "").includes("text/html")) return plain();

  let title: string | null = null;
  try {
    title = await findTitle(c, c.req.param("id") ?? "");
  } catch {
    title = null;
  }
  if (title === null) return plain();

  const text = shareText(title);
  // setAttribute は " を自分で直してくれるが、& < > は直さないので、先にこちらで直す(念のため)
  const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const setContent = (value: string) => ({
    element(el: Element) {
      el.setAttribute("content", attr(value));
    },
  });
  // setInnerContent は、文字を HTML として扱わずに書き込む(タイトルに < などがあっても安全)
  const rewritten = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(text.title);
      },
    })
    .on('meta[property="og:title"]', setContent(text.title))
    .on('meta[property="og:description"]', setContent(text.description))
    .on('meta[name="description"]', setContent(text.description))
    .on('meta[property="og:url"]', setContent(new URL(c.req.url).origin + new URL(c.req.url).pathname))
    .transform(new Response(asset.body, { status: asset.status, headers }));
  return rewritten;
}
