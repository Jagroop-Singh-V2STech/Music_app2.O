export interface Song { id: string; title: string; artist: string; album?: string; imageUrl?: string | null; pageUrl?: string; audioUrl?: string; duration?: number }
export interface Playlist { id: string; name: string; description?: string; coverImage?: string; songs: Song[]; createdAt: string; updatedAt: string }
export type LyricsScript = "hinglish" | "original";
export interface Settings { autoplay: boolean; lyricsScript: LyricsScript; sleepFadeSeconds: number }
