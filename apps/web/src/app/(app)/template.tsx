import type { ReactNode } from "react";

/**
 * Each page fades and rises in when you navigate. Plain CSS, so content is
 * never left invisible if scripts are slow; reduced motion turns it off.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
