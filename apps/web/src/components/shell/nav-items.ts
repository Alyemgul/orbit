import { Columns3, Compass, FileText, Inbox, UserRound, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Single source of truth for both the desktop sidebar and mobile tab bar. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/pipeline", label: "Pipeline", icon: Columns3 },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/resume", label: "Resume", icon: FileText },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
