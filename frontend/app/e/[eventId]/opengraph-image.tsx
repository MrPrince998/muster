import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getPublicEvent, placesLine } from "@/lib/public-event";

// The card a shared link shows: the event as a Muster ticket. Archivo as the
// app sets it (fixed instances: the renderer can't use variable fonts).
export const alt = "A public event on Muster";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COBALT = "#2f45d8";
const INK = "#1a1f36";
const STAMP = "#d7263d";

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/Archivo-CondensedExtraBold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Archivo-Medium.ttf")),
  readFile(join(process.cwd(), "public/muster_logo.png"), "base64"),
]);

export default async function Image({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const [display, body, logo] = await fonts;
  const event = await getPublicEvent(eventId);

  const zone = event?.timeZone ?? "UTC";
  const at = event ? new Date(event.startsAt) : null;
  const part = (options: Intl.DateTimeFormatOptions) => (at ? new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...options }).format(at) : "");
  const cancelled = event?.status === "cancelled";
  // long titles step down, so up to three lines always fit
  const title = event?.title ?? "An event on Muster";
  const titleSize = title.length > 48 ? 64 : title.length > 26 ? 80 : 104;

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: COBALT, padding: 64, fontFamily: "Archivo" }}>
        {/* the event */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 48 }}>
          <img src={`data:image/png;base64,${logo}`} height={40} style={{ height: 40, width: 160, objectFit: "contain", objectPosition: "left" }} alt="" />
          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
            {event && (
              <div style={{ display: "flex", fontFamily: "Archivo Body", fontSize: 30, color: "#c9d0fb" }}>
                {`${event.clubName}, ${event.workspaceName}`}
              </div>
            )}
            <div
              style={{
                display: "flex",
                fontSize: titleSize,
                lineHeight: 0.95,
                color: "white",
                marginTop: 16,
                // still legible (it's how people know which event this was); the stub says it's off
                opacity: cancelled ? 0.75 : 1,
              }}
            >
              {title}
            </div>
          </div>
        </div>

        {/* the ticket stub: the date as tickets print it, then where and how many places */}
        {event && at && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 340,
              background: "white",
              borderRadius: 28,
              color: INK,
              position: "relative",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "36px 32px 28px" }}>
              <div style={{ display: "flex", fontFamily: "Archivo Body", fontSize: 28, color: COBALT }}>{part({ weekday: "long" })}</div>
              <div style={{ display: "flex", fontSize: 150, lineHeight: 1, color: COBALT }}>{part({ day: "numeric" })}</div>
              <div style={{ display: "flex", fontSize: 44, color: COBALT }}>{part({ month: "long" })}</div>
              <div style={{ display: "flex", fontFamily: "Archivo Body", fontSize: 32, marginTop: 8 }}>{part({ hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            {/* the tear line, with a notch punched at each end */}
            <div style={{ display: "flex", position: "relative", height: 2, margin: "0 28px", borderTop: "3px dashed #d4d4d8" }} />
            <div style={{ position: "absolute", left: -18, top: 316, width: 36, height: 36, borderRadius: 18, background: COBALT }} />
            <div style={{ position: "absolute", right: -18, top: 316, width: 36, height: 36, borderRadius: 18, background: COBALT }} />
            <div style={{ display: "flex", flexDirection: "column", padding: "24px 32px", fontFamily: "Archivo Body", fontSize: 26, gap: 10 }}>
              {event.location && <div style={{ display: "flex" }}>{event.location}</div>}
              <div style={{ display: "flex", color: cancelled ? STAMP : COBALT, fontFamily: "Archivo", fontSize: 34 }}>
                {placesLine(event)}
              </div>
            </div>
          </div>
        )}
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Archivo", data: display, weight: 800, style: "normal" },
        { name: "Archivo Body", data: body, weight: 500, style: "normal" },
      ],
    },
  );
}
