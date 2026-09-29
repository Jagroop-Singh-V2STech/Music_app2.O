import type { Song } from "../types/music";
const base = "https://music-be.jagroop-singh-v2stech.workers.dev";
export async function searchSongs(query: string): Promise<Song[]> {
  const response = await fetch(
    `${base}/api/search?find=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error("Search is unavailable");
  return parseSearchResults(await response.text());
}
export async function getSongDetails(
  url: string,
): Promise<Pick<Song, "audioUrl">> {
  const response = await fetch(
    `${base}/api/song?url=${encodeURIComponent(url)}`,
  );
  if (!response.ok) throw new Error("Song cannot be played");
  const result = (await response.json()) as Pick<Song, "audioUrl">;
  return {
    audioUrl: result.audioUrl && new URL(result.audioUrl, base).href,
  };
}
function parseSearchResults(html: string): Song[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = new Set<string>();
  return Array.from(doc.querySelectorAll("a")).flatMap((link) => {
    const href = link.getAttribute("href");
    const raw =
      link.querySelector("b")?.textContent?.trim() || link.textContent?.trim();
    if (!href || !raw || !href.includes("/songs/") || found.has(href))
      return [];
    found.add(href);
    const parts = raw.split(" - ");
    const image = link.querySelector("img")?.getAttribute("src");
    return [
      {
        id: href,
        title: parts.shift()?.trim() || "Untitled",
        artist: parts.join(" - ").trim() || "Unknown artist",
        pageUrl: new URL(href, "https://pagalnew.com").href,
        imageUrl: image ? new URL(image, "https://pagalnew.com").href : null,
      },
    ];
  });
}
