import Link from 'next/link';

export default function SheetNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1>Sheet not found</h1>
      <p className="text-muted-foreground mt-2">
        It may have been deleted, or the link is wrong.{' '}
        <Link href=".." className="text-focus underline">
          Go back
        </Link>
      </p>
    </main>
  );
}
