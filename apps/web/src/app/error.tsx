"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description={
          error.digest ? `The error was logged (reference ${error.digest}).` : "The error was logged. Try again."
        }
      >
        <Button onClick={reset}>Try again</Button>
      </EmptyState>
    </main>
  );
}
