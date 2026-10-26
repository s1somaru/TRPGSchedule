import type { TimeRange } from "./time";

// API でやりとりするデータの形(spec.md 5章)。サーバーと画面で共有する

/** 記号:o = ◯、t = △、x = × */
export type Status = "o" | "t" | "x";

/** 1日分の予定 */
export interface DayEntry {
  s: Status;
  memo?: string;
  /** 空いている時間(任意)。× の日には付けない(spec.md 3.18) */
  time?: TimeRange;
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
}

export interface PastSessionSummary {
  id: string;
  title: string;
  role: "GM" | "PL";
  /** 開催日(日付順・すべて過ぎた日) */
  confirmedDates: string[];
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
