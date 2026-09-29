import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LoaderCircle, Play, Search as SearchIcon, X } from "lucide-react";
import { useSearch } from "../hooks/useSearch";
import { useMusic } from "../context/MusicContext";
import { usePlayer } from "../context/PlayerContext";
import { EmptyState } from "../components/common/EmptyState";
import { Loading, CardSkeletons } from "../components/common/Loading";
import { SongRow } from "../components/music/SongRow";
import { ArtistCard } from "../components/music/ArtistCard";
import { AlbumCard } from "../components/music/AlbumCard";
import { Artwork } from "../components/music/Artwork";
import { PlaylistCard } from "../components/playlist/PlaylistCard";
import { musicStorage } from "../utils/storage";
import { deriveAlbums, deriveArtists, hueFrom } from "../utils/library";

const GENRES = ["Bollywood", "Punjabi", "Romantic", "Party", "Lo-fi", "Workout", "Sad", "Devotional", "Hip Hop", "Indie", "Retro", "Chill"];
const FILTERS = ["All", "Songs", "Artists", "Albums", "Playlists"] as const;
type Filter = typeof FILTERS[number];

export function Search() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [debounced, setDebounced] = useState(query);
  const [filter, setFilter] = useState<Filter>("All");
  const [history, setHistory] = useState(musicStorage.searches);
  const { playlists } = useMusic();
  const { play } = usePlayer();

  // Sync when the URL changes from outside this input (header search, links, back/forward).
  const urlQuery = params.get("q") || "";
  useEffect(() => { if (urlQuery !== query) { setQuery(urlQuery); setDebounced(urlQuery); } }, [urlQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setTimeout(() => setDebounced(query), 400); return () => clearTimeout(id); }, [query]);
  const result = useSearch(debounced);
  const songs = result.data ?? [];

  useEffect(() => {
    const q = debounced.trim();
    if (!result.data?.length || q.length < 2) return;
    setHistory(items => { const next = [q, ...items.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8); musicStorage.setSearches(next); return next; });
  }, [result.data, debounced]);

  const update = (value: string) => { setQuery(value); setParams(value ? { q: value } : {}, { replace: true }); };
  const artists = useMemo(() => deriveArtists(songs), [songs]);
  const albums = useMemo(() => deriveAlbums(songs), [songs]);
  const q = debounced.trim().toLowerCase();
  const matchedPlaylists = q ? playlists.filter(p => p.name.toLowerCase().includes(q) || p.songs.some(s => `${s.title} ${s.artist}`.toLowerCase().includes(q))) : [];
  const pending = query.trim().length > 1 && (query !== debounced || result.isFetching);
  const top = songs[0];
  const show = (f: Filter) => filter === "All" || filter === f;

  return (
    <section className="page search-page">
      <label className="large-search">
        <SearchIcon aria-hidden="true" />
        <input autoFocus type="search" value={query} placeholder="What do you want to listen to?" aria-label="Search songs, artists, albums" onChange={e => update(e.target.value)} />
        {pending ? <LoaderCircle className="spin" aria-label="Searching" /> : query && <button className="icon-button" aria-label="Clear search" onClick={() => update("")}><X /></button>}
      </label>

      {!query.trim() && <>
        {history.length > 0 && <div className="recent-searches fade-up"><div className="row-head"><h2>Recent searches</h2><button className="text-btn" onClick={() => { setHistory([]); musicStorage.setSearches([]); }}>Clear</button></div><div className="chips">{history.map(h => <button className="chip" key={h} onClick={() => update(h)}>{h}</button>)}</div></div>}
        <h2 className="browse-title">Browse all</h2>
        <div className="genre-grid fade-up">{GENRES.map(g => <button key={g} className="genre-tile" style={{ "--hue": hueFrom(g) } as React.CSSProperties} onClick={() => update(g)}><span>{g}</span></button>)}</div>
      </>}

      {query.trim() && <>
        <div className="chips filter-chips" role="tablist" aria-label="Filter results">{FILTERS.map(f => <button key={f} role="tab" aria-selected={filter === f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</button>)}</div>

        {query.trim().length < 2 ? <p className="muted">Keep typing…</p>
          : result.isError ? <EmptyState title="Search unavailable" copy="The music service did not respond. Please try again." />
          : result.isLoading || (query !== debounced && !result.data) ? <div className="results-skeleton"><Loading rows={4} /><div className="card-grid"><CardSkeletons count={5} /></div></div>
          : !songs.length && !matchedPlaylists.length ? <EmptyState icon={<SearchIcon />} title={`No results found for “${debounced}”`} copy="Check the spelling, or try fewer or different keywords." />
          : <div className="results fade-in" key={debounced}>
              {filter === "All" && top && <div className="top-row">
                <section><h2>Top result</h2><div className="top-result"><Artwork song={top} className="top-art" /><strong>{top.title}</strong><span><em className="tag">Song</em>{top.artist}</span><button className="card-play" aria-label={`Play ${top.title}`} onClick={() => void play(top, songs)}><Play fill="currentColor" /></button></div></section>
                <section className="top-songs"><h2>Songs</h2><div className="song-table">{songs.slice(0, 4).map(s => <SongRow song={s} list={songs} draggable key={s.id} />)}</div></section>
              </div>}
              {filter === "Songs" && <section><h2 className="visually-hidden">Songs</h2><div className="song-table">{songs.map((s, i) => <SongRow song={s} index={i} list={songs} draggable key={s.id} />)}</div></section>}
              {show("Artists") && artists.length > 0 && <section className="result-group"><h2>Artists</h2><div className={filter === "All" ? "shelf-row" : "card-grid"}>{artists.map(a => <ArtistCard artist={a} key={a.name} />)}</div></section>}
              {show("Albums") && albums.length > 0 && <section className="result-group"><h2>Albums & Singles</h2><div className={filter === "All" ? "shelf-row" : "card-grid"}>{albums.map(a => <AlbumCard album={a} key={a.id} />)}</div></section>}
              {show("Playlists") && <section className="result-group"><h2>Playlists</h2>{matchedPlaylists.length ? <div className="card-grid">{matchedPlaylists.map(p => <PlaylistCard playlist={p} key={p.id} />)}</div> : <p className="muted">None of your playlists match. <Link to="/playlists" className="inline-link">See all playlists</Link></p>}</section>}
            </div>}
      </>}
    </section>
  );
}
