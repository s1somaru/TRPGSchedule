// 日本の祝日(spec.md 3.20)
// 外のサービスには問い合わせず、「国民の祝日に関する法律」の決まりから計算する。
// - 2020年〜2099年に対応(春分・秋分の計算式が使えるのが2099年まで)
// - 一度きりの変更(例:2020・2021年のオリンピックの移動)は EXCEPTIONS に手で書く
// - 内閣府が公開している祝日の一覧(syukujitsu.csv)と同じになることを、テストで確かめる

const MIN_YEAR = 2020;
const MAX_YEAR = 2099;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** その月の第 n 月曜日 */
function nthMonday(y: number, m: number, n: number): number {
  const first = weekday(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

/** 春分の日・秋分の日(1980〜2099年の計算式) */
function equinox(y: number, base: number): number {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

/** 年ごとの一度きりの移動(その年は、決まりの日ではなくこの日になる) */
const EXCEPTIONS: Record<number, Partial<Record<"umi" | "yama" | "sports", [number, number]>>> = {
  2020: { umi: [7, 23], sports: [7, 24], yama: [8, 10] },
  2021: { umi: [7, 22], sports: [7, 23], yama: [8, 8] },
};

const cache = new Map<number, Map<string, string>>();

/** その年の祝日(振替休日・国民の休日を含む)。日付 → 祝日名 */
export function holidaysOfYear(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const out = new Map<string, string>();
  if (y < MIN_YEAR || y > MAX_YEAR) {
    cache.set(y, out);
    return out;
  }
  const ex = EXCEPTIONS[y] ?? {};
  const add = (m: number, d: number, name: string) => out.set(ymd(y, m, d), name);

  add(1, 1, "元日");
  add(1, nthMonday(y, 1, 2), "成人の日");
  add(2, 11, "建国記念の日");
  add(2, 23, "天皇誕生日");
  add(3, equinox(y, 20.8431), "春分の日");
  add(4, 29, "昭和の日");
  add(5, 3, "憲法記念日");
  add(5, 4, "みどりの日");
  add(5, 5, "こどもの日");
  if (ex.umi) add(...ex.umi, "海の日");
  else add(7, nthMonday(y, 7, 3), "海の日");
  if (ex.yama) add(...ex.yama, "山の日");
  else add(8, 11, "山の日");
  add(9, nthMonday(y, 9, 3), "敬老の日");
  add(9, equinox(y, 23.2488), "秋分の日");
  if (ex.sports) add(...ex.sports, "スポーツの日");
  else add(10, nthMonday(y, 10, 2), "スポーツの日");
  add(11, 3, "文化の日");
  add(11, 23, "勤労感謝の日");

  const base = [...out.keys()].sort();

  // 国民の休日:前の日と次の日が祝日で、その日が祝日でも日曜でもない日
  for (const date of base) {
    const next2 = shift(date, 2);
    const between = shift(date, 1);
    if (out.has(next2) && !out.has(between) && dayOfWeek(between) !== 0) out.set(between, "国民の休日");
  }

  // 振替休日:祝日が日曜なら、その後で最初の「祝日でない日」が休み
  for (const date of base) {
    if (dayOfWeek(date) !== 0) continue;
    let d = shift(date, 1);
    while (out.has(d)) d = shift(d, 1);
    out.set(d, "振替休日");
  }

  cache.set(y, out);
  return out;
}

function shift(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return weekday(y, m, d);
}

/** 祝日なら祝日名、そうでなければ undefined */
export function holidayName(date: string): string | undefined {
  return holidaysOfYear(Number(date.slice(0, 4))).get(date);
}
