import type { Playlist, Song } from "../types/music";

// The API only returns songs, so artists, albums and mixes are derived views over them.
export interface Artist { name: string; imageUrl?: string | null; songs: Song[] }
export interface Album { id: string; name: string; artist: string; imageUrl?: string | null; songs: Song[]; kind: "Album" | "Single" }
export interface Mix { id: string; title: string; subtitle: string; imageUrl?: string | null; songs: Song[]; hue: number }

export const uniqueSongs = (songs: Song[]) => songs.filter((song, i, all) => all.findIndex(x => x.id === song.id) === i);

export const primaryArtist = (artist: string) => artist.split(/,|&| feat\.? | ft\.? | x /i)[0].trim() || artist;

export function hueFrom(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function deriveArtists(songs: Song[]): Artist[] {
  const map = new Map<string, Artist>();
  for (const song of uniqueSongs(songs)) {
    const name = primaryArtist(song.artist);
    if (!name || /unknown/i.test(name)) continue;
    const key = name.toLowerCase();
    const artist = map.get(key) ?? { name, imageUrl: song.imageUrl, songs: [] };
    artist.imageUrl ||= song.imageUrl;
    artist.songs.push(song);
    map.set(key, artist);
  }
  return [...map.values()].sort((a, b) => b.songs.length - a.songs.length);
}

export function deriveAlbums(songs: Song[]): Album[] {
  const map = new Map<string, Album>();
  for (const song of uniqueSongs(songs)) {
    const name = song.album?.trim() || song.title;
    const key = `${name}::${primaryArtist(song.artist)}`.toLowerCase();
    const album = map.get(key) ?? { id: key, name, artist: primaryArtist(song.artist), imageUrl: song.imageUrl, songs: [], kind: song.album ? "Album" : "Single" };
    album.imageUrl ||= song.imageUrl;
    album.songs.push(song);
    map.set(key, album);
  }
  return [...map.values()];
}

export function deriveMixes(favorites: Song[], recent: Song[]): Mix[] {
  const pool = uniqueSongs([...favorites, ...recent]);
  if (!pool.length) return [];
  const mixes: Mix[] = [];
  if (favorites.length) mixes.push({ id: "liked-mix", title: "Liked Mix", subtitle: "Songs you love and more like them", imageUrl: favorites[0].imageUrl, songs: favorites, hue: 262 });
  deriveArtists(pool).slice(0, 4).forEach((artist, i) => {
    const rest = pool.filter(song => !artist.songs.includes(song));
    mixes.push({ id: `daily-${i}`, title: `Daily Mix ${i + 1}`, subtitle: `${artist.name} and more`, imageUrl: artist.imageUrl, songs: [...artist.songs, ...rest].slice(0, 30), hue: hueFrom(artist.name) });
  });
  if (recent.length > 3) mixes.push({ id: "on-repeat", title: "On Repeat", subtitle: "The songs you can't stop playing", imageUrl: recent[0].imageUrl, songs: recent.slice(0, 30), hue: 18 });
  return mixes;
}

// Playlists append songs, favorites prepend them, so the newest additions are at those ends.
export function recentlyAdded(favorites: Song[], playlists: Playlist[]) {
  const fromPlaylists = [...playlists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).flatMap(p => [...p.songs].reverse().slice(0, 4));
  return uniqueSongs([...favorites.slice(0, 6), ...fromPlaylists]).slice(0, 12);
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export const shuffled = <T,>(items: T[]) => [...items].sort(() => Math.random() - .5);
