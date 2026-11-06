import { Compass } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <EmptyState icon={Compass} title="Page not found" description="This page drifted out of orbit.">
        <Link href="/discover" className={buttonVariants()}>
          Back to Discover
        </Link>
      </EmptyState>
    </main>
  );
}
