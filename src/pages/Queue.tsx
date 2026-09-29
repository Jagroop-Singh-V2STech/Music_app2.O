import { PageHeader } from "../components/common/PageHeader";
import { QueueList } from "../components/player/QueueList";

export const Queue = () => <section className="page queue-page"><PageHeader eyebrow="Your listening" title="Queue" hue={30} compact /><QueueList /></section>;
