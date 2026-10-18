import { BrandPanel } from "./brand-panel";
import { Logo } from "./logo";

/**
 * The frame every auth screen shares (sign in, sign up, reset): the brand
 * panel on large screens, the form on the right. Server Component;
 * only the form inside is interactive.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel />
      <main className="relative flex min-w-0 flex-col px-5 py-8 sm:px-10">
        <Logo className="lg:hidden" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
