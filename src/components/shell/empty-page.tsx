/** A page whose content is not built yet: the heading and an honest empty state, no controls. */
export function EmptyPage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex w-full flex-col gap-4 px-4 py-8">
      <h1>{title}</h1>
      <div className="border-line bg-background-100 rounded-lg border border-dashed p-6">
        <p className="text-muted-foreground">{message}</p>
      </div>
    </main>
  );
}
