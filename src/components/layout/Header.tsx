import { ChevronLeft, ChevronRight, Menu, Search, WifiOff } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useOffline } from "../../context/OfflineContext";

export function Header({ onMenu, solid }: { onMenu(): void; solid: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const onSearchPage = location.pathname === "/search";
  const { online } = useOffline();
  return (
    <header className={`header ${solid ? "solid" : ""}`}>
      <button className="circle-btn mobile-menu" aria-label="Open menu" onClick={onMenu}><Menu /></button>
      <div className="history-nav">
        <button className="circle-btn" aria-label="Go back" onClick={() => navigate(-1)}><ChevronLeft /></button>
        <button className="circle-btn" aria-label="Go forward" onClick={() => navigate(1)}><ChevronRight /></button>
      </div>
      {!onSearchPage && <label className="searchbox"><Search aria-hidden="true" /><input aria-label="Search music" type="search" placeholder="What do you want to play?" onKeyDown={e => { if (e.key === "Enter" && e.currentTarget.value.trim()) navigate(`/search?q=${encodeURIComponent(e.currentTarget.value)}`); }} /><kbd>/</kbd></label>}
      <div className="header-spacer" />
      {!online && <Link to="/downloads" className="offline-pill" title="You're offline — open your downloads"><WifiOff aria-hidden="true" />Offline</Link>}
      <div className="profile" aria-label="Profile">M</div>
    </header>
  );
}
