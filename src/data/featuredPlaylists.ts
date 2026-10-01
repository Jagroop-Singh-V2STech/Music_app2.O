// Prebuilt playlists. The API only supports search, so each playlist is a blend of seed queries.
export interface FeaturedPlaylist { id: string; title: string; description: string; queries: string[]; hue: number }

export const featuredPlaylists: FeaturedPlaylist[] = [
  { id: "todays-top-hits", title: "Today's Top Hits", description: "The hottest tracks right now.", queries: ["trending", "new", "hits"], hue: 142 },
  { id: "bollywood-romance", title: "Bollywood Romance", description: "Love songs from Arijit, Atif, Shreya and more.", queries: ["arijit singh", "atif aslam", "shreya ghoshal", "ishq"], hue: 340 },
  { id: "punjabi-101", title: "Punjabi 101", description: "Sidhu, Diljit, AP Dhillon and Karan Aujla.", queries: ["sidhu moose wala", "diljit dosanjh", "ap dhillon", "karan aujla"], hue: 32 },
  { id: "party-starters", title: "Party Starters", description: "Turn it up — dance floor bangers.", queries: ["party", "dance", "badshah", "honey singh"], hue: 290 },
  { id: "lofi-chill", title: "Lofi Chill", description: "Laid-back beats to relax and study to.", queries: ["lofi", "chill", "acoustic"], hue: 200 },
  { id: "heartbreak", title: "Heartbreak", description: "For when it hurts.", queries: ["sad", "breakup", "broken"], hue: 228 },
  { id: "workout-beast", title: "Beast Mode", description: "High-energy tracks to power your workout.", queries: ["gym", "dj", "remix"], hue: 8 },
  { id: "retro-classics", title: "Retro Classics", description: "Timeless songs from Kishore, Lata and the 90s.", queries: ["kishore kumar", "lata mangeshkar", "90s", "retro"], hue: 45 },
  { id: "unplugged", title: "Unplugged", description: "Stripped-back acoustic versions.", queries: ["unplugged", "acoustic", "anuv jain"], hue: 168 },
  { id: "sufi-soul", title: "Sufi Soul", description: "Qawwalis and sufi gems from Nusrat to Rahat.", queries: ["sufi", "qawwali", "nusrat", "rahat fateh ali khan"], hue: 262 },
  { id: "haryanvi-hits", title: "Haryanvi Hits", description: "Desi beats from Masoom Sharma and more.", queries: ["haryanvi", "masoom sharma", "pranjal dahiya"], hue: 88 },
  { id: "devotional", title: "Bhakti", description: "Bhajans for a peaceful start.", queries: ["bhajan", "krishna", "shiv", "hanuman"], hue: 24 },
];

export const findFeatured = (id: string) => featuredPlaylists.find(p => p.id === id);
