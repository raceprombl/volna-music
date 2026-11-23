import { defaults, type AppState, type Settings } from "../types";
import { rpc } from "../shared";
export const installed = !!globalThis.chrome?.runtime?.id;
export async function getState(): Promise<AppState> {
  return installed
    ? rpc("GET_STATE")
    : {
        settings: {
          ...defaults,
          ...JSON.parse(localStorage.getItem("volna-preview-settings") || "{}"),
        },
        jobs: [],
        tokenPresent: false,
      };
}
export async function getPage(full = false) {
  return installed ? rpc("PAGE", { full }) : null;
}
export async function saveSettings(settings: Settings) {
  if (installed) return rpc("SETTINGS", { settings });
  localStorage.setItem("volna-preview-settings", JSON.stringify(settings));
  return settings;
}
