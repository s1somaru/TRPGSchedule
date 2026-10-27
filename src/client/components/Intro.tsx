// トップの紹介(初めて来た人に、何ができて何がうれしいかを伝える)
// 中身はすべてこのファイルに書いてある見本で、サーバーには問い合わせない
import { STATUS_SYMBOL } from "../format";
import type { Status } from "../../shared/types";
import { ClockIcon } from "./Icons";

/** 卓の表の見本 */
function SampleTable() {
  const people = ["GM ゆき", "たろう", "はな", "けん"];
  const rows: { date: string; cells: Status[]; badge?: string; clock?: number }[] = [
    { date: "11/7(金)", cells: ["o", "o", "t", "x"] },
    { date: "11/8(土)", cells: ["o", "o", "o", "o"], badge: "全員OK" },
    { date: "11/9(日)", cells: ["t", "o", "x", "o"] },
    { date: "11/14(金)", cells: ["o", "t", "o", "t"], clock: 3 },
  ];
  return (
    <figure class="intro-sample">
      <div class="sample-card" aria-hidden="true">
        <p class="sample-title">セッション「霧の館」 21:00〜</p>
        <table class="sample-table">
          <thead>
            <tr>
              <th />
              {people.map((p) => (
                <th key={p}>{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} class={r.badge ? "sample-ok" : ""}>
                <th>
                  {r.date}
                  {r.badge && <span class="badge badge-ok">{r.badge}</span>}
                </th>
                {r.cells.map((s, i) => (
                  <td key={i} class={`c-${s}`}>
                    {STATUS_SYMBOL[s]}
                    {r.clock === i && (
                      <span class="clock-mark">
                        <ClockIcon size={12} />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption class="muted">
        卓ページの見本。全員の予定が1つの表に並び、全員が参加できる日がひと目でわかります。
      </figcaption>
    </figure>
  );
}

const MERITS: { title: string; text: string }[] = [
  { title: "登録もログインもなし", text: "名前を入れるだけで始められます。メールアドレスもパスワードも要りません。" },
  { title: "予定は1回入れるだけ", text: "自分のカレンダーに入れた予定が、参加している卓ぜんぶに反映されます。卓ごとに入れ直す必要はありません。" },
  { title: "なぞって、まとめて入力", text: "長押しして日付をなぞると、◯△×をまとめて付けられます。時間やメモもスタンプにして、一気に付けられます。" },
  { title: "時間帯まで見て判定", text: "「21時から」のような卓の時間帯と、参加者の空いている時間を照らし合わせて、合うかを自動で判定します。" },
  { title: "GMは表を見て決めるだけ", text: "全員の予定が1つの表に並びます。日を選んで「この日に決める」を押せば、開催日が決まります。" },
  { title: "キャンペーンにも", text: "開催日はいくつでも決められます。次の開催日が、卓ページの一番上に大きく出ます。" },
];

const FAQ: { q: string; a: string }[] = [
  { q: "お金はかかりますか?", a: "かかりません。アプリのインストールも要らず、スマホでもパソコンでもブラウザで使えます。" },
  { q: "予定は誰に見えますか?", a: "参加している卓のメンバーに、その卓の候補日の予定が見えます(候補日は卓のGMが決めます)。参加していない卓には見えません。" },
  { q: "編集URLをなくしたら?", a: "同じ端末なら、トップの「最近開いたもの」から開けます。ほかの端末で使うときのために、作ったときに保存しておいてください。" },
  { q: "PLもカレンダーを作る必要がありますか?", a: "はい。名前を入れるだけで作れます。一度作れば、ほかのGMの卓にもそのまま使えます。" },
  {
    q: "データはいつまで残りますか?",
    a: "1年間使われていないカレンダーは、自動で削除されます(参加していた卓には名前だけが残ります)。過去の予定は90日分だけ残ります。終わった卓は、最後の日から90日たつと、予定を除いた記録として残ります。",
  },
];

export function Intro(props: { onCreate: () => void; hasCalendar: boolean }) {
  return (
    <>
      <section class="intro-block intro-hero-visual">
        <SampleTable />
      </section>

      <section class="intro-block" aria-labelledby="merits">
        <h2 id="merits">たくよせでできること</h2>
        <ul class="merit-grid">
          {MERITS.map((m) => (
            <li class="merit-card" key={m.title}>
              <h3>{m.title}</h3>
              <p>{m.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section class="intro-block" id="how" aria-labelledby="flows">
        <h2 id="flows">使い方:日程が決まるまで</h2>
        <div class="flow-grid">
          <div class="flow-card">
            <p class="flow-role">GM</p>
            <ol>
              <li>自分のカレンダーを作る</li>
              <li>卓を作って、候補日を選ぶ</li>
              <li>卓URLを Discord や LINE で送る</li>
              <li>表を見て、開催日を決める</li>
            </ol>
          </div>
          <div class="flow-card">
            <p class="flow-role">PL</p>
            <ol>
              <li>届いた卓URLを開く</li>
              <li>カレンダーを作って参加する</li>
              <li>◯△× を入れる</li>
              <li>あとは予定が変わったら直すだけ</li>
            </ol>
          </div>
        </div>
      </section>

      <section class="intro-block" aria-labelledby="faq">
        <h2 id="faq">よくある質問</h2>
        <dl class="faq">
          {FAQ.map((f) => (
            <div class="faq-item" key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {!props.hasCalendar && (
        <section class="intro-block intro-final">
          <p class="intro-final-lead">まずは自分のカレンダーを作ってみましょう。1分で終わります。</p>
          <button type="button" class="btn btn-primary btn-big" onClick={props.onCreate}>
            カレンダーを作る
          </button>
        </section>
      )}
    </>
  );
}
