export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-soft flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="bg-card border-line w-full max-w-md rounded-[var(--radius-card)] border p-6 sm:p-8">
        {children}
      </div>
    </main>
  );
}
