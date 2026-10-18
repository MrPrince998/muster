import { Logo } from "./logo";
import { TicketIllustration } from "./ticket-illustration";

/**
 * The poster side of the auth screens: one flat ink, the ticket, the
 * headline. Hidden on small screens. Pinned to the viewport height so it
 * never makes the page scroll: on short screens the ticket shrinks, and on
 * very short ones (a laptop with browser toolbars) the paragraph drops out.
 */
export function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between gap-8 overflow-hidden bg-cobalt p-10 text-white lg:sticky lg:top-0 lg:flex lg:h-svh xl:p-14">
      <Logo />

      <div className="flex min-h-0 flex-1 items-center justify-center [@media(max-height:50rem)_and_(min-height:44rem)]:-my-10 [@media(max-height:50rem)_and_(min-height:44rem)]:scale-[0.82] [@media(max-height:44rem)]:-my-[4.5rem] [@media(max-height:44rem)]:scale-[0.66]">
        <TicketIllustration />
      </div>

      <div className="max-w-lg space-y-4">
        <h2 className="text-6xl leading-[0.92] font-extrabold font-stretch-65% xl:text-7xl">
          From invite link to front door.
        </h2>
        <p className="max-w-sm text-base leading-relaxed text-white/80 [@media(max-height:44rem)]:hidden">
          Publish your club&rsquo;s events, take registrations, and check people
          in with a scan.
        </p>
      </div>
    </aside>
  );
}
