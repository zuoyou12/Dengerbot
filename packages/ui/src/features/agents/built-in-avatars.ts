import type { AvatarImageInput } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { normalizeAvatarImage } from "../../avatar-image";

export interface BuiltInAvatar {
  id: string;
  name: string;
  labelKey?: AppTextKey;
  url: string;
}

// 自动扫描引入 assets/bots/ 下的所有 png 形象
const botImages = import.meta.glob<string>("../../assets/bots/*.png", {
  eager: true,
  import: "default",
});

function prettifyName(filename: string): string {
  // 处理 comment_xxx 或 file_xxx 等复杂文件名
  if (filename.startsWith("comment_") || filename.startsWith("file_")) {
    return `Avatar ${filename.slice(-6)}`;
  }
  return filename
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const standardAvatars: BuiltInAvatar[] = [];
for (const [path, url] of Object.entries(botImages)) {
  const match = path.match(/\/([^/]+)\.png$/);
  if (!match || !match[1]) continue;
  const id = match[1];
  
  standardAvatars.push({
    id,
    name: prettifyName(id),
    url,
  });
}

// 常用形象排在最前。
const priorityOrder: Record<string, number> = {
  blonde: 0,
  black: 1,
  ponytail: 2,
  "dark-bob": 3,
};

standardAvatars.sort((a, b) => {
  const prioA = priorityOrder[a.id] ?? 100;
  const prioB = priorityOrder[b.id] ?? 100;
  if (prioA !== prioB) return prioA - prioB;
  return a.name.localeCompare(b.name);
});

export const BUILT_IN_AVATARS: readonly BuiltInAvatar[] = standardAvatars;

// The bytes never change for the life of the app, so one fetch per preset is enough.
const bytesCache = new Map<string, Promise<Uint8Array>>();

function builtInAvatarBytes(url: string): Promise<Uint8Array> {
  const cached = bytesCache.get(url);
  if (cached) return cached;
  const loaded = fetch(url)
    .then((response) => response.arrayBuffer())
    .then((buffer) => new Uint8Array(buffer));
  bytesCache.set(url, loaded);
  loaded.catch(() => bytesCache.delete(url));
  return loaded;
}

// 原始 png 通常远超后端 512KB 的存储上限，保存前先压成存储格式（512px webp）。
const imageCache = new Map<string, Promise<AvatarImageInput>>();

/** The stored image for a preset, ready for `setAgentAvatar`. */
export async function builtInAvatarImage(avatar: BuiltInAvatar): Promise<AvatarImageInput> {
  const cached = imageCache.get(avatar.id);
  if (cached) return cached;
  const loaded = builtInAvatarBytes(avatar.url).then((bytes) => normalizeAvatarImage("image/png", bytes));
  imageCache.set(avatar.id, loaded);
  loaded.catch(() => imageCache.delete(avatar.id));
  return loaded;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Which preset, if any, the agent's stored avatar is a copy of.
 */
export async function matchBuiltInAvatar(avatarUrl: string): Promise<string | null> {
  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) return null;
    const stored = new Uint8Array(await response.arrayBuffer());
    for (const avatar of BUILT_IN_AVATARS) {
      if (bytesEqual(stored, (await builtInAvatarImage(avatar)).bytes)) return avatar.id;
    }
  } catch {
    // An unreadable avatar shows as no selection rather than an error in the picker.
  }
  return null;
}
