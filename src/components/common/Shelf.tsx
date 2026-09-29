import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface ShelfProps { title: string; subtitle?: string; to?: string; children: ReactNode; layout?: "row" | "grid" }

// A titled section whose cards scroll horizontally ("row") or wrap into a responsive grid.
export function Shelf({ title, subtitle, to, children, layout = "row" }: ShelfProps) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = () => { const el = track.current; if (el) setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 }); };
  useEffect(() => { update(); const el = track.current; if (!el) return; const observer = new ResizeObserver(update); observer.observe(el); return () => observer.disconnect(); }, [children]);
  const scroll = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth * .8, behavior: "smooth" });
  return (
    <section className="shelf fade-up">
      <div className="shelf-head">
        <div><h2>{to ? <Link to={to}>{title}</Link> : title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <div className="shelf-tools">
          {to && <Link className="show-all" to={to}>Show all</Link>}
          {layout === "row" && <>
            <button className="circle-btn sm" aria-label={`Scroll ${title} left`} disabled={edges.start} onClick={() => scroll(-1)}><ChevronLeft /></button>
            <button className="circle-btn sm" aria-label={`Scroll ${title} right`} disabled={edges.end} onClick={() => scroll(1)}><ChevronRight /></button>
          </>}
        </div>
      </div>
      <div ref={track} className={layout === "row" ? "shelf-row" : "card-grid"} onScroll={layout === "row" ? update : undefined}>{children}</div>
    </section>
  );
}
