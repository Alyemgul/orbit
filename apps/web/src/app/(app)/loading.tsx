/** Skeleton shown while a page's data loads. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="skeleton h-7 w-40 rounded-lg" />
        <div className="skeleton h-4 w-72 max-w-full rounded-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-3 rounded-2xl border bg-surface p-5">
            <div className="skeleton h-4 w-1/2 rounded-md" />
            <div className="skeleton h-3 w-5/6 rounded-md" />
            <div className="skeleton h-3 w-2/3 rounded-md" />
          </div>
        ))}
      </div>
      <div className="skeleton h-64 rounded-2xl" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
