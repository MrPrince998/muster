import Image from "next/image";
import Link from "next/link";

/** The frame for pages anyone can open (a public event, a guest's ticket): the mark, and a way to sign in. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b px-5 sm:px-8">
        <Link href="/" aria-label="Muster" className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <Image src="/muster_logo_inverted.png" alt="" width={100} height={25} className="h-6 w-auto" />
        </Link>
        <Link href="/login" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Sign in
        </Link>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
