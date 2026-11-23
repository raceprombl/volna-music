/** Read only the known Music OAuth entry; never enumerate or copy site storage. */
export function existingMusicAccessToken(): string | null {
  if (!/^https:\/\/music\.yandex\.(ru|kz|com|by|uz)$/.test(location.origin))
    return null;
  try {
    const raw = localStorage.getItem("aYa_token");
    if (!raw || raw.length > 8192) return null;
    const value = JSON.parse(raw)?.access_token;
    return typeof value === "string" && /^[a-zA-Z0-9_.-]{20,4000}$/.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
