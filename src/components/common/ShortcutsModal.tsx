import { Modal } from "./Modal";

const SHORTCUTS: [string[], string][] = [
  [["Space"], "Play / pause"],
  [["→"], "Forward 5 seconds"],
  [["←"], "Back 5 seconds"],
  [["N"], "Next song"],
  [["M"], "Mute / unmute"],
  [["/"], "Search"],
  [["?"], "Show these shortcuts"]
];

export function ShortcutsModal({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action}><dt>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dt><dd>{action}</dd></div>
        ))}
      </dl>
      <p className="muted shortcut-note">Shortcuts work anywhere except while typing in a text field. In a Jam they control the room.</p>
    </Modal>
  );
}
