/** A page whose content is not built yet: the heading and an honest empty state, no controls. */
export function EmptyPage({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <h1>{title}</h1>
      <div className="border-line rounded-[var(--radius-card)] border border-dashed bg-white p-6">
        <p className="text-muted-foreground">{message}</p>
      </div>
    </main>
  );
}
