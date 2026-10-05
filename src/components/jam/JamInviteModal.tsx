import { useMemo } from "react";
import { encode } from "uqr";
import { Link2, Share2 } from "lucide-react";
import { Modal } from "../common/Modal";

interface Props { roomId: string; url: string; onCopy(): void; onShare?(): void; onClose(): void }

/** Scannable invite: one SVG path of the dark modules, drawn dark-on-white so every phone camera reads it. */
function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { size, path: d };
  }, [value]);
  return (
    <svg className="jam-qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="QR code for the Jam invite link">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#10140a" />
    </svg>
  );
}

export default function JamInviteModal({ roomId, url, onCopy, onShare, onClose }: Props) {
  return (
    <Modal title="Invite to the Jam" onClose={onClose}>
      <div className="jam-invite">
        <QrCode value={url} />
        <p className="muted">Scan with a phone camera to join, or enter the code</p>
        <span className="jam-code jam-code-lg">{roomId}</span>
      </div>
      <div className="modal-actions">
        {onShare && <button className="secondary" onClick={onShare}><Share2 aria-hidden="true" /> Share</button>}
        <button className="primary" onClick={onCopy}><Link2 aria-hidden="true" /> Copy link</button>
      </div>
    </Modal>
  );
}
