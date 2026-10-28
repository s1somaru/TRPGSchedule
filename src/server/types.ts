// Hono に渡す型(Worker の環境変数・データの保存先)
export interface AppEnv {
  Bindings: Env;
}

/** wrangler.jsonc に書かない値(secret)。本番だけで設定し、手元の開発環境にはないことがある */
interface SecretEnv {
  /** Resend の API キー(お問い合わせの通知用。src/server/notify.ts) */
  RESEND_API_KEY?: string;
  /** お問い合わせを知らせる先のメールアドレス */
  NOTIFY_EMAIL?: string;
}

declare global {
  // worker-configuration.d.ts(wrangler types が作る)の Env に足す
  interface Env extends SecretEnv {}
  namespace Cloudflare {
    interface Env extends SecretEnv {}
  }
}
