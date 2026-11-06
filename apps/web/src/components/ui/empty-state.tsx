import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Empty states explain what will appear here and how to get there. */
export function EmptyState({ icon: Icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">{description}</p>
      {children ? <div className="mt-6 w-full max-w-xl">{children}</div> : null}
    </div>
  );
}
