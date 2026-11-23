import type { ItemUpdate } from "./progress-batch";
import type {
  AppState,
  Collection,
  Format,
  Job,
  QueueItem,
  Settings,
  Source,
  Track,
} from "./types";

export interface LibraryStatusResult {
  connected: boolean;
  name?: string;
  permission: PermissionState;
}

export interface SortLibraryResult {
  count: number;
  renamed: { from: string; to: string }[];
}

export type EngineState = AppState & { token: string };

export interface DownloadStateResult {
  state: string;
  error?: string;
}

export interface RpcMap {
  API_PERMIT: { req: { requestId: string }; res: void };
  API_CANCEL: { req: { requestId: string }; res: void };
  API_BACKOFF: { req: { ms: number }; res: void };
  LIBRARY_STATUS: { req: Record<never, never>; res: LibraryStatusResult };
  CACHE_STATUS: { req: Record<never, never>; res: { temporaryBytes: number } };
  OPEN_LIBRARY_SETTINGS: { req: Record<never, never>; res: void };
  SORT_LIBRARY: { req: Record<never, never>; res: SortLibraryResult };
  LIBRARY_REINDEX: {
    req: {
      jobId: string;
      index: number;
      filename: string;
      number: number;
      renamed: { from: string; to: string }[];
    };
    res: void;
  };
  CONNECT_ACCOUNT: {
    req: Record<never, never>;
    res: { connected: boolean; opened?: boolean };
  };
  OPEN_SETTINGS: { req: Record<never, never>; res: void };
  EXPORT_TRACKLIST: { req: { collection: Collection }; res: number };
  RENDER_METADATA: {
    req: Record<never, never>;
    res: { updated: number } | undefined;
  };
  GET_STATE: { req: Record<never, never>; res: AppState };
  GET_DOWNLOAD_SETTINGS: {
    req: Record<never, never>;
    res: Pick<Settings, "format" | "quality" | "zip" | "concurrency">;
  };
  SESSION_SOURCE: {
    req: { id: string; format: string; quality: string };
    res: Source;
  };
  GET_ACTIVE_JOB: { req: Record<never, never>; res: Job | null };
  PAGE: {
    req: { tabId?: number; full?: boolean };
    res: { collection: Collection; tabId: number } | null;
  };
  GET_JOB: { req: { id: string }; res: Job | undefined };
  SETTINGS: { req: { settings: Settings }; res: Settings };
  SET_TOKEN: { req: { token: string }; res: { present: boolean } };
  FORMATS: {
    req: { id: string };
    res: { codec: string; bitrate: number }[];
  };
  EXPAND: { req: Record<never, never>; res: Collection | undefined };
  ENQUEUE: {
    req: {
      title: string;
      kind?: Collection["kind"];
      tracks: Track[];
      settings?: Partial<Settings>;
    };
    res: string;
  };
  CANCEL_JOB: { req: { id: string }; res: void };
  RETRY: { req: { id: string }; res: void };
  CLEAR_HISTORY: { req: Record<never, never>; res: void };
  OPEN_MUSIC: { req: Record<never, never>; res: void };
  SHOW_FILE: { req: { id: number }; res: void };
  SESSION_LYRICS: {
    req: { id: string; format: "LRC" | "TEXT" };
    res: { downloadUrl?: string } | null;
  };
  ENGINE_STATE: { req: Record<never, never>; res: EngineState };
  ENGINE_PATCH: {
    req: {
      id: string;
      patch?: Partial<Job>;
      index?: number;
      item?: Partial<QueueItem>;
    };
    res: void;
  };
  ENGINE_PATCH_ITEMS: {
    req: { id: string; items: ItemUpdate[]; patch?: Partial<Job> };
    res: void;
  };
  SAVE_BLOB: {
    req: { url: string; filename: string; jobId: string; index?: number };
    res: number;
  };
  DOWNLOAD_STATE: {
    req: { id: number };
    res: DownloadStateResult | null;
  };
}

export type RpcCommand = keyof RpcMap;

export type RpcRequest = {
  [K in RpcCommand]: { type: K } & RpcMap[K]["req"];
}[RpcCommand];

export type OffscreenMessage =
  | { target: "offscreen"; type: "ENGINE_STATUS" }
  | { target: "offscreen"; type: "SORT_LIBRARY" }
  | { target: "offscreen"; type: "CANCEL"; id: string }
  | { target: "offscreen"; type: "CLEAN"; jobs: { id: string; count: number }[] }
  | { target: "offscreen"; type: "WAKE" };

export type ContentMessage =
  | { type: "COLLECTION" }
  | { type: "COLLECTION_FULL" }
  | {
      type: "SESSION_SOURCE";
      id: string;
      format: Format;
      quality: Settings["quality"];
    }
  | { type: "SESSION_LYRICS"; id: string; format: "LRC" | "TEXT" };
