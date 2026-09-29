const base =
  window.MYMUSIC_API_BASE || "https://music-be.jagroop-singh-v2stech.workers.dev";
export async function searchSongs(query) {
  const response = await fetch(
    `${base}/api/search?find=${encodeURIComponent(query)}`,
  );
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return parseSearchResults(await response.text());
}
export async function getSongDetails(pageUrl) {
  const response = await fetch(
    `${base}/api/song?url=${encodeURIComponent(pageUrl)}`,
  );
  if (!response.ok) throw new Error(`Song lookup failed (${response.status})`);
  const result = await response.json();
  if (!result.audioUrl) throw new Error("No playable URL found");
  return { ...result, audioUrl: new URL(result.audioUrl, base).href };
}
function parseSearchResults(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set();
  return [...doc.querySelectorAll("a")].flatMap((link) => {
    const href = link.getAttribute("href");
    const raw =
      link.querySelector("b")?.textContent?.trim() || link.textContent.trim();
    if (!href || !raw || !href.includes("/songs/") || seen.has(href)) return [];
    seen.add(href);
    const parts = raw.split(" - ");
    const image = link.querySelector("img")?.getAttribute("src");
    return [
      {
        id: href,
        title: parts.shift().trim(),
        artist: parts.join(" - ").trim() || "Unknown artist",
        pageUrl: new URL(href, "https://pagalnew.com").href,
        imageUrl: image ? new URL(image, "https://pagalnew.com").href : null,
        audioUrl: null,
      },
    ];
  });
}
