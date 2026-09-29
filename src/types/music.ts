export interface Song { id: string; title: string; artist: string; album?: string; imageUrl?: string | null; pageUrl?: string; audioUrl?: string; duration?: number }
export interface Playlist { id: string; name: string; description?: string; coverImage?: string; songs: Song[]; createdAt: string; updatedAt: string }
export interface Settings { autoplay: boolean; quality: "128 KBPS" | "320 KBPS" }
