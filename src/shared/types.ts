// API でやりとりするデータの形(spec.md 5章)。サーバーと画面で共有する

/** 記号:o = ◯、t = △、x = × */
export type Status = "o" | "t" | "x";

/** 1日分の予定 */
export interface DayEntry {
  s: Status;
  memo?: string;
}

/** 日付ごとの予定。未入力の日は含めない */
export type Availability = Record<string, DayEntry>;

export interface CalendarResponse {
  id: string;
  displayName: string;
  availability: Availability;
  inputRange: { from: string; to: string };
  lastUpdatedAt: string;
}

export interface CalendarCreatedResponse extends CalendarResponse {
  editSecret: string;
}


export interface MySessionSummary {
  id: string;
  title: string;
  role: "GM" | "PL";
  confirmedDate: string | null;
  firstCandidateDate: string;
  lastCandidateDate: string;
}

export interface PastSessionSummary {
  id: string;
  title: string;
  role: "GM" | "PL";
  confirmedDate: string;
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
  lastUpdatedAt: string | null;
}

export interface SessionResponse {
  id: string;
  title: string;
  candidateDates: string[];
  confirmedDate: string | null;
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
