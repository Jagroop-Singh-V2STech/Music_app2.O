import { Link2, Share2 } from "lucide-react";
import { Modal } from "../common/Modal";
import { QrCode } from "../common/QrCode";

interface Props { roomId: string; url: string; onCopy(): void; onShare?(): void; onClose(): void }

export default function JamInviteModal({ roomId, url, onCopy, onShare, onClose }: Props) {
  return (
    <Modal title="Invite to the Jam" onClose={onClose}>
      <div className="jam-invite">
        <QrCode value={url} label="QR code for the Jam invite link" />
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
