// Small helpers the marketplace service used to own: a routine schedule with a fresh anchor,
// a timezone validity check, and the image sniffing and buffer conversion of avatar bytes.
// They stay because agent import, instance transfer and the timezone store use them too.

import type { AvatarImageInput, RoutineSchedule } from "@openbot/contracts/ipc";

export function localSchedule(schedule: RoutineSchedule): RoutineSchedule {
  return schedule.kind === "interval" ? { ...schedule, anchorAt: new Date().toISOString() } : structuredClone(schedule);
}

export function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function imageMimeType(bytes: Uint8Array): AvatarImageInput["mimeType"] | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
    return "image/webp";
  return null;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
