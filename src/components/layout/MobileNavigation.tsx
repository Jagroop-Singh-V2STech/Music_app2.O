import { Heart, House, Library, Search } from "lucide-react";
import { NavLink } from "react-router-dom";

const items = [["/", House, "Home"], ["/search", Search, "Search"], ["/library", Library, "Your Library"], ["/favorites", Heart, "Liked"]] as const;

export const MobileNavigation = () => <nav className="mobile-nav" aria-label="Main">{items.map(([to, Icon, label]) => <NavLink key={to} to={to} end={to === "/"}><Icon aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>;
