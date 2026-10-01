import { useEffect, useRef } from "react";
import { MicVocal } from "lucide-react";
import { usePlayer } from "../../context/PlayerContext";
import { useLyrics } from "../../hooks/useLyrics";
import { hueFrom } from "../../utils/library";

const MANUAL_SCROLL_PAUSE = 3000;

// Spotify-style lyrics: synced lines light up and auto-scroll with playback; click a line to jump there.
export function LyricsView({ className = "" }: { className?: string }) {
  const { currentSong, progress, duration, seek, playing, toggle } = usePlayer();
  const { lyrics, isLoading, isError, retry } = useLyrics(currentSong, duration);
  const box = useRef<HTMLDivElement>(null);
  const manualScrollAt = useRef(0);

  const synced = lyrics?.kind === "synced" ? lyrics.lines : [];
  let active = -1;
  for (let i = 0; i < synced.length && synced[i].time <= progress + .25; i++) active = i;

  useEffect(() => { box.current?.scrollTo({ top: 0 }); }, [currentSong?.id]);
  useEffect(() => {
    const container = box.current;
    const line = container?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!container || !line || Date.now() - manualScrollAt.current < MANUAL_SCROLL_PAUSE) return;
    container.scrollTo({ top: line.offsetTop - container.clientHeight * .35, behavior: "smooth" });
  }, [active]);

  const jump = (time: number) => { seek(time); if (!playing) toggle(); };
  const markManual = () => { manualScrollAt.current = Date.now(); };

  let body;
  if (!currentSong) body = <Message title="Play a song to see its lyrics" />;
  else if (isLoading) body = <div className="lyrics-skeleton" aria-label="Loading lyrics">{[70, 90, 55, 80, 65].map((w, i) => <span className="skeleton" key={i} style={{ width: `${w}%` }} />)}</div>;
  else if (isError) body = <Message title="Couldn't load lyrics" copy={navigator.onLine ? "The lyrics service is busy right now." : "Lyrics need a connection unless the song is downloaded."}>{navigator.onLine && <button className="pill light" onClick={retry}>Try again</button>}</Message>;
  else if (!lyrics) body = <Message title="No lyrics for this song" copy="We couldn't find lyrics for this one yet." />;
  else if (lyrics.kind === "instrumental") body = <Message title="Instrumental" copy="Enjoy the music — there are no words in this one." />;
  else if (lyrics.kind === "plain") body = <div className="lyrics-lines plain">{lyrics.lines.map((text, i) => <p key={i}>{text || " "}</p>)}<small className="lyrics-note">These lyrics aren't synced to the song yet.</small></div>;
  else body = (
    <div className="lyrics-lines">
      {lyrics.lines.map((line, i) => (
        <button key={i} data-line={i} className={`lyric ${i === active ? "active" : i < active ? "past" : ""}`} onClick={() => jump(line.time)}>{line.text || "♪"}</button>
      ))}
    </div>
  );

  return (
    <div ref={box} className={`lyrics ${className}`} style={{ "--hue": hueFrom(currentSong?.title ?? "music") } as React.CSSProperties} onWheel={markManual} onTouchMove={markManual}>
      {body}
      {lyrics && <p className="lyrics-credit">Lyrics provided by LRCLIB</p>}
    </div>
  );
}

const Message = ({ title, copy, children }: { title: string; copy?: string; children?: React.ReactNode }) => <div className="lyrics-message"><MicVocal aria-hidden="true" /><strong>{title}</strong>{copy && <span>{copy}</span>}{children}</div>;
