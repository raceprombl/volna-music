export type Format = "original" | "mp3" | "flac" | "aac" | "ogg" | "wav";
export interface Track {
  id: string;
  title: string;
  artists: string;
  album?: string;
  year?: number;
  cover?: string;
  duration?: number;
  available?: boolean;
  genre?: string;
  lyricsInfo?: {
    hasAvailableSyncLyrics?: boolean;
    hasAvailableTextLyrics?: boolean;
  };
}
export interface Collection {
  title: string;
  kind: "playlist" | "album" | "likes" | "page";
  tracks: Track[];
  url: string;
  partial?: boolean;
}
export interface Settings {
  theme: "dark" | "light" | "system";
  format: Format;
  quality: "best" | "192" | "128";
  concurrency: number;
  zip: boolean;
  numbering: boolean;
  covers: boolean;
  metadata: boolean;
  folder: string;
  coverSize: 400 | 600 | 800 | 1000;
  logLevel: "off" | "error" | "warn" | "info" | "debug";
  lyricsTags: boolean;
  lyricsFile: boolean;
  unicodeFilenames: boolean;
  structuredFolders: boolean;
}
export const defaults: Settings = {
  theme: "dark",
  format: "original",
  quality: "best",
  concurrency: 12,
  zip: true,
  numbering: true,
  covers: true,
  metadata: true,
  folder: "VOLNA",
  coverSize: 400,
  logLevel: "off",
  lyricsTags: false,
  lyricsFile: false,
  unicodeFilenames: false,
  structuredFolders: true,
};
export type ItemStatus =
  | "queued"
  | "resolving"
  | "fetching"
  | "ready"
  | "saving"
  | "complete"
  | "failed"
  | "skipped"
  | "cancelled";
export interface QueueItem {
  track: Track;
  status: ItemStatus;
  bytes: number;
  total: number;
  filename?: string;
  error?: string;
  downloadId?: number;
  lyricsFilename?: string;
  notice?: string;
  folderSaved?: boolean;
}
export interface Job {
  id: string;
  title: string;
  kind?: Collection["kind"];
  trackNumber?: number;
  created: number;
  updated: number;
  status:
    | "queued"
    | "running"
    | "packing"
    | "complete"
    | "partial"
    | "failed"
    | "cancelled"
    | "interrupted";
  settings: Settings;
  items: QueueItem[];
  downloadId?: number;
  error?: string;
  transfer?: {
    receivedBytes: number;
    totalBytes?: number;
    estimated: boolean;
    bytesPerSecond?: number;
    remainingSeconds?: number;
    pendingTracks: number;
    updatedAt: number;
  };
}
export interface AppState {
  settings: Settings;
  jobs: Job[];
  tokenPresent: boolean;
  nextTrackNumber?: number;
}
export interface Source {
  codec: string;
  bitrate: number;
  url: string;
  urls?: string[];
  expiresAt?: number;
}
export interface Reply<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
  retryAfter?: number;
}
export const activeJobs = (j: Job) =>
  ["queued", "running", "packing"].includes(j.status);
