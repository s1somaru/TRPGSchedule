import type { DayTime, TimeRange } from "./time";

// API でやりとりするデータの形(spec.md 5章)。サーバーと画面で共有する

/** 記号:o = ◯、t = △、x = × */
export type Status = "o" | "t" | "x";

/** 1日分の予定 */
export interface DayEntry {
  s: Status;
  memo?: string;
  /** 空いている時間(任意)。× の日には付けない(spec.md 3.18)。読むときは rangesOf を通す */
  time?: DayTime;
}

/** 曜日ごとの「いつもの時間」。キーは曜日("0" = 日曜 〜 "6" = 土曜) */
export type WeeklyTimes = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", TimeRange>>;

/** 日付ごとの予定。未入力の日は含めない */
export type Availability = Record<string, DayEntry>;

export interface CalendarResponse {
  id: string;
  displayName: string;
  availability: Availability;
  inputRange: { from: string; to: string };
  lastUpdatedAt: string;
  /** 曜日ごとの「いつもの時間」(本人だけが見る。卓には渡さない) */
  weeklyTimes: WeeklyTimes;
}

export interface CalendarCreatedResponse extends CalendarResponse {
  editSecret: string;
}


export interface MySessionSummary {
  id: string;
  title: string;
  role: "GM" | "PL";
  /** 開催日(日付順)。未確定なら空 */
  confirmedDates: string[];
  firstCandidateDate: string;
  lastCandidateDate: string;
  /** 開催日ごとの時間帯(なければ null)。本人だけが見る */
  confirmedTimes: Record<string, TimeRange | null>;
}

export interface PastSessionSummary {
  id: string;
  title: string;
  role: "GM" | "PL";
  /** 開催日(日付順・すべて過ぎた日) */
  confirmedDates: string[];
  /** 開催日ごとの時間帯(なければ null) */
  confirmedTimes: Record<string, TimeRange | null>;
  archived: boolean;
}

export interface MySessionsResponse {
  active: MySessionSummary[];
  past: PastSessionSummary[];
}

export interface ErrorResponse {
  error: { code: string; message: string; details?: unknown };
}

export type Role = "GM" | "PL";

/** 卓の参加者(卓ページに出す形) */
export interface ParticipantView {
  id: string;
  role: Role;
  displayName: string;
  /** カレンダーが削除された参加者 */
  calendarDeleted: boolean;
  /** 候補日に当たる日だけ。記録・削除済みカレンダーは空 */
  availability: Availability;
  /**
   * ほかの卓の開催日と重なっている日だけ(design/busy-and-multi-times.md 2.4)。
   * 卓の名前・時刻は入れない。重なりを入れた後の記号だけ
   */
  busy?: Record<string, BusyCell>;
}

/** ほかの卓の開催日と重なっている日の記号。s が null は未入力。adjusted は本人の時刻のせいで変わったとき */
export interface BusyCell {
  s: Status | null;
  adjusted: boolean;
  /** GM が見ているときだけ(本人の行を除く)。この卓の時間帯の中で重なっている時間。null は時刻不明 */
  overlap?: TimeRange[] | null;
  /** 本人の行だけ。重なっている、自分のほかの卓 */
  sessions?: BusySession[];
}

/** 本人にだけ見せる、重なっているほかの卓 */
export interface BusySession {
  id: string;
  title: string;
  /** その日の時間帯(なければ null) */
  time: TimeRange | null;
}

export interface SessionResponse {
  id: string;
  title: string;
  candidateDates: string[];
  /** 開催日(日付順)。複数あってよい。未確定なら空 */
  confirmedDates: string[];
  /** 卓の時間帯(任意) */
  timeWindow: TimeRange | null;
  /** 日ごとの時間帯(卓の時間帯と違う日だけ) */
  dateTimes: Record<string, TimeRange>;
  archived: boolean;
  participants: ParticipantView[];
  /** 見ている人が参加者なら、その参加情報 */
  me: { participantId: string; role: Role } | null;
}

export interface ParticipantResponse {
  id: string;
  role: Role;
  displayName: string;
}
