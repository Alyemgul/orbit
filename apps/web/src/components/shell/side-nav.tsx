"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "./nav-items";
import { ThemeSwitcher } from "./theme-switcher";
import { UserFooter } from "./user-footer";

interface SideNavProps {
  email: string | null;
}

/** Desktop navigation (md and up). */
export function SideNav({ email }: SideNavProps) {
  const pathname = usePathname();

  return (
    <aside aria-label="Sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-surface md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/discover" aria-label="Orbit home">
          <Logo />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 px-3 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text",
                    active && "text-accent hover:bg-transparent hover:text-accent",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-lg bg-accent-soft"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }}
                      aria-hidden
                    />
                  ) : null}
                  <Icon className="relative size-[18px]" aria-hidden />
                  <span className="relative">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-3 border-t p-3">
        <ThemeSwitcher />
        <UserFooter email={email} />
      </div>
    </aside>
  );
}
