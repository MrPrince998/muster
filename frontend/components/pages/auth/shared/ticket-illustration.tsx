import { cn } from "@/lib/utils";

/**
 * The product in one picture: a signed event pass, scanned and stamped at
 * the door. Pure SVG and CSS (a Server Component, no JavaScript shipped).
 * The scan and stamp loop; with reduced motion the stamp is simply there.
 */

// A QR-like 25x25 grid: real finder patterns in three corners, the rest a
// fixed pseudo-random fill, so server and client render the same picture.
const SIZE = 25;
const qrModules = (() => {
  let seed = 0x5eed;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= SIZE - 8 && y < 8) || (x < 8 && y >= SIZE - 8);
  const finderCell = (x: number, y: number) => {
    const fx = x >= SIZE - 8 ? x - (SIZE - 7) : x;
    const fy = y >= SIZE - 8 ? y - (SIZE - 7) : y;
    if (fx < 0 || fy < 0 || fx > 6 || fy > 6) return false; // separator
    return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
  };
  const cells: [number, number][] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inFinder(x, y) ? finderCell(x, y) : random() < 0.48) cells.push([x, y]);
    }
  }
  return cells;
})();

function QrCode({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={className} shapeRendering="crispEdges" aria-hidden>
      {qrModules.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
      ))}
    </svg>
  );
}

// Where the tear line runs: the height of the ticket's top half. The notches
// are cut at the same height.
const TEAR_AT = "14.5rem";

// Two half-width radial masks, each cutting a semicircle out of one edge, so
// the notches are real holes that show whatever is behind the ticket.
const notchMask = [
  `radial-gradient(circle 0.8rem at 0 ${TEAR_AT}, transparent 98%, #000) left / 51% 100% no-repeat`,
  `radial-gradient(circle 0.8rem at 100% ${TEAR_AT}, transparent 98%, #000) right / 51% 100% no-repeat`,
].join(", ");

/** The paper: rounded, with the two notches punched at the tear line. */
function TicketPaper({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn("relative flex h-full flex-col rounded-3xl text-ink", className)}
      style={{ mask: notchMask, WebkitMask: notchMask }}
    >
      {children}
    </div>
  );
}

/** Another pass in this week's stack: only its edges show, so just the outline of one. */
function BackTicket({ club, title, className }: { club: string; title: string; className: string }) {
  return (
    <div className={cn("absolute inset-0", className)}>
      <TicketPaper className="bg-cobalt-100">
        <div className="p-6 pb-0" style={{ height: TEAR_AT }}>
          <span className="inline-block rounded-full bg-cobalt/10 px-2.5 py-1 text-xs font-semibold text-cobalt">
            {club}
          </span>
          <p className="mt-3 text-4xl leading-none font-extrabold font-stretch-70% text-ink/70">{title}</p>
        </div>
        <div className="mx-7 border-t-2 border-dashed border-cobalt/20" />
        <div className="flex flex-1 items-center px-7">
          <QrCode className="size-28 fill-ink/25" />
        </div>
      </TicketPaper>
    </div>
  );
}

export function TicketIllustration() {
  return (
    <div className="relative mx-auto h-[25.5rem] w-[22rem]" aria-hidden>
      {/* other events this week, fanned out behind */}
      <BackTicket club="Film Society" title="Movie Night" className="-translate-x-10 translate-y-3 -rotate-[9deg]" />
      <BackTicket club="Chess Club" title="Blitz Open" className="translate-x-9 -translate-y-1 rotate-[7deg]" />

      {/* the pass; the shadow sits on this wrapper because the mask on the
          paper would clip a box-shadow */}
      <div className="absolute inset-0 -rotate-2 drop-shadow-[0_28px_48px_rgb(16_24_100/0.5)]">
        <TicketPaper className="bg-white">
          <div className="p-6 pb-0" style={{ height: TEAR_AT }}>
            <span className="inline-block rounded-full bg-cobalt/10 px-2.5 py-1 text-xs font-semibold text-cobalt">
              Robotics Club
            </span>
            <h3 className="mt-3 text-4xl leading-none font-extrabold font-stretch-70%">Demo Night</h3>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">When</dt>
                <dd className="mt-0.5 font-medium">Fri 24 Oct, 18:30</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Where</dt>
                <dd className="mt-0.5 font-medium">Eng. Hall B</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-zinc-500">Attendee</dt>
                <dd className="mt-0.5 font-medium">Ada Lovelace</dd>
              </div>
            </dl>
          </div>

          {/* tear line, between the notches */}
          <div className="mx-7 border-t-2 border-dashed border-zinc-200" />

          {/* the stub: fills the rest, QR centred in it and in line with the tear line */}
          <div className="flex flex-1 items-center gap-5 px-7">
            <div className="relative shrink-0 overflow-hidden rounded-xl bg-white p-2 ring-1 ring-zinc-200">
              <QrCode className="size-28 fill-ink" />
              {/* the scanner's line, sweeping exactly the code */}
              <div
                className="pointer-events-none absolute inset-x-2 top-2 h-0.5 bg-cobalt opacity-0 shadow-[0_0_10px_2px] shadow-cobalt/50 motion-safe:animate-scan"
                style={{ "--scan-distance": "7rem" } as React.CSSProperties}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-semibold">Signed pass</p>
              <p className="text-xs leading-relaxed text-zinc-500">Works once. Copies are rejected at the door.</p>
              <p className="text-xs text-zinc-400 tabular-nums">MU-7F3A-29D1</p>
            </div>
          </div>

          {/* the door stamp, in the empty corner beside the title */}
          <div className="absolute top-11 right-5 -rotate-12 rounded-lg border-[3px] border-stamp px-2.5 py-1 text-stamp mix-blend-multiply motion-safe:animate-stamp">
            <p className="text-lg leading-none font-extrabold font-stretch-70%">Checked in</p>
            <p className="mt-0.5 text-[11px] font-semibold tabular-nums">18:42</p>
          </div>
        </TicketPaper>
      </div>
    </div>
  );
}
