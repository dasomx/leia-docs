import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center text-center flex-1 px-4 gap-6">
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
        LEIA
      </h1>
      <p className="max-w-lg text-lg text-fd-muted-foreground">
        Learning Experience AI — transform content into interactive AI tutors.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-6 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Documentation
        </Link>
        <Link
          href="/docs/openapi"
          className="inline-flex items-center justify-center rounded-lg border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
        >
          API Reference
        </Link>
      </div>
    </main>
  );
}
