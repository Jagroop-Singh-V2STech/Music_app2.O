import { useEffect, useState } from "react";
import { Link2, LoaderCircle, Share2 } from "lucide-react";
import type { Song } from "../../types/music";
import { Modal } from "../common/Modal";
import { QrCode, QR_MAX_LENGTH } from "../common/QrCode";
import { useToast } from "../common/Toast";
import { MAX_SHARED_SONGS, encodeShare, shareUrl } from "../../utils/share";

interface Props { kind: "song" | "playlist"; songs: Song[]; name?: string; onClose(): void }

/** Loaded on demand (it pulls in the QR encoder). */
export default function ShareModal({ kind, songs, name, onClose }: Props) {
  const toast = useToast();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const title = kind === "song" ? songs[0]?.title : name;

  useEffect(() => {
    let cancelled = false;
    encodeShare(kind, songs, name).then(data => { if (!cancelled) setUrl(shareUrl(data)); }).catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : "This can't be shared."); });
    return () => { cancelled = true; };
  }, [kind, name, songs]);

  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch { toast("Couldn't copy the link", "error"); }
  };
  const share = url && typeof navigator.share === "function" ? () => void navigator.share({ title: title ?? "MyMusic", text: kind === "song" ? `Listen to ${title} on MyMusic` : `Check out my playlist “${title}” on MyMusic`, url }).catch(() => undefined) : undefined;

  return (
    <Modal title={kind === "song" ? "Share song" : "Share playlist"} onClose={onClose}>
      <div className="jam-invite share-body">
        {error ? <p className="jam-error">{error}</p>
          : !url ? <LoaderCircle className="spin" aria-label="Creating link" />
          : url.length <= QR_MAX_LENGTH ? <QrCode value={url} label={`QR code for ${title}`} ecc="L" />
          : <p className="muted share-note">This playlist is too long for a QR code. Share the link instead.</p>}
        <strong className="share-title">{title}</strong>
        <p className="muted">{kind === "song" ? songs[0]?.artist : `${Math.min(songs.length, MAX_SHARED_SONGS)} songs${songs.length > MAX_SHARED_SONGS ? ` (first ${MAX_SHARED_SONGS} of ${songs.length})` : ""}`}</p>
      </div>
      <div className="modal-actions">
        {share && <button className="secondary" onClick={share}><Share2 aria-hidden="true" /> Share</button>}
        <button className="primary" disabled={!url} onClick={() => void copy()}><Link2 aria-hidden="true" /> Copy link</button>
      </div>
    </Modal>
  );
}
