// ID と秘密の形式(spec.md 5.2)

const B64URL = "[A-Za-z0-9_-]";

export const ID_PATTERNS = {
  calendar: new RegExp(`^cal_${B64URL}{22}$`),
  session: new RegExp(`^ses_${B64URL}{22}$`),
  participation: new RegExp(`^prt_${B64URL}{22}$`),
  secret: new RegExp(`^sec_${B64URL}{43}$`),
} as const;

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function random(prefix: string, byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return prefix + base64url(bytes);
}

export const newCalendarId = () => random("cal_", 16);
export const newSessionId = () => random("ses_", 16);
export const newParticipationId = () => random("prt_", 16);
export const newSecret = () => random("sec_", 32);
