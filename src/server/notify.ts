// お問い合わせが届いたことを、運営者にメールで知らせる(spec.md 3.17)
//
// メールは Resend(https://resend.com)の API で送る。使う値は Worker の secret に入れる:
//   RESEND_API_KEY … Resend の API キー(送信だけできるもの)
//   NOTIFY_EMAIL   … 知らせる先のメールアドレス(リポジトリに載せないため secret にする)
// どちらかがなければ何もしない(手元の開発環境・テスト)。
//
// メールには、内容と返信先(個人情報)を入れない。届いたこと・種類・ページ・日時だけを書き、
// 中身は `npm run feedback` で読む。送れなくても問い合わせの保存には影響しない。

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** 自分のドメインがない間は、Resend が用意した送り元を使う(自分のアカウントのアドレスにだけ送れる) */
const FROM = "たくよせ <onboarding@resend.dev>";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "不具合の報告",
  request: "要望・アイデア",
  question: "使い方の質問",
  other: "そのほか",
};

export interface ContactNotice {
  category: string;
  page: string | null;
  createdAt: Date;
}

/** メールの件名と本文 */
export function contactNoticeMail(notice: ContactNotice): { subject: string; text: string } {
  const label = CATEGORY_LABELS[notice.category] ?? notice.category;
  const at = notice.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" });
  return {
    subject: `[たくよせ] お問い合わせが届きました(${label})`,
    text: [
      "たくよせにお問い合わせが1件届きました。",
      "",
      `種類:${label}`,
      `送ったページ:${notice.page ?? "(不明)"}`,
      `日時:${at}(日本時間)`,
      "",
      "内容と返信先は、このメールには入れていません。",
      "リポジトリのフォルダで npm run feedback を実行して確認してください。",
    ].join("\n"),
  };
}

/** お問い合わせが届いたことを知らせる。失敗してもエラーにはせず、ログに残すだけ */
export async function notifyContact(env: Env, notice: ContactNotice): Promise<void> {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;
  const mail = contactNoticeMail(notice);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [env.NOTIFY_EMAIL], subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) console.error(JSON.stringify({ code: "NOTIFY_FAILED", status: res.status }));
  } catch (err) {
    console.error(JSON.stringify({ code: "NOTIFY_FAILED", name: err instanceof Error ? err.name : "UnknownError" }));
  }
}
