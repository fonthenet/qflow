import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10">
      <div className="text-center space-y-6 px-4">
        <h1 className="text-5xl font-bold tracking-tight">
          Queue<span className="text-primary">Flow</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-md mx-auto">
          Smart queue management for modern businesses. No more waiting in
          uncertainty.
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          >
            Staff Login
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-6 py-3 text-sm font-medium shadow-sm hover:bg-muted transition-colors"
          >
            Register Business
          </Link>
        </div>
      </div>
    </div>
  );
}
