import Link from 'next/link';
import { logout } from '@/lib/actions/auth-actions';

export default function AccountNotLinkedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 px-4">
      <div className="w-full max-w-2xl rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="max-w-xl">
          <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
            Account needs business access
          </div>
          <h1 className="mt-4 text-3xl font-bold text-foreground">This login is not linked to a business yet</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You signed in successfully, but this account does not have a team record inside a business.
            A business admin needs to add you to their team before you can use the dashboard.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-muted/20 p-5">
            <h2 className="text-base font-semibold text-foreground">If you were invited by a business</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Ask the business admin to add your email address under <span className="font-medium text-foreground">Team Access</span>.
              Once they do that, you can sign in again and go straight to your dashboard.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/20 p-5">
            <h2 className="text-base font-semibold text-foreground">If you want your own business account</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a new business workspace instead, then you will get your own admin access automatically.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="inline-flex items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Register a business
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="inline-flex items-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
