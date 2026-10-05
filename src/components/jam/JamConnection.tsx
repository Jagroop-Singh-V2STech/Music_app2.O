import type { JamConnectionStatus } from "../../types/jam";

const labels: Record<JamConnectionStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected — retrying"
};

export const JamConnection = ({ status }: { status: JamConnectionStatus }) => (
  <span className={`jam-status ${status}`} role="status"><i className="jam-dot" aria-hidden="true" />{labels[status]}</span>
);
