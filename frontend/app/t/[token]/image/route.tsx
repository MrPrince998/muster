/* eslint-disable @next/next/no-img-element -- drawn to a PNG by the image renderer, never sent as HTML */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { formatFullDate, formatTime, formatTimeRange } from "@/components/pages/workspace/org-home/parts/format";
import { getTicket } from "@/lib/public-event";

// A ticket as a picture, phone-screen sized: saved to the camera roll it gets
// you in with no signal and no app, the QR code big enough to scan from a
// dim phone. The same ticket as on screen: the event on top, the code on the
// stub. Archivo as the app sets it (fixed instances: the renderer can't use
// variable fonts).
const size = { width: 1080, height: 1920 };

const COBALT = "#2f45d8";
const INK = "#1a1f36";
const MUTED = "#6b7280";
const STAMP = "#d7263d";

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/fonts/Archivo-CondensedExtraBold.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Archivo-Medium.ttf")),
  readFile(join(process.cwd(), "public/muster_logo.png"), "base64"),
]);

const fileSlug = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60) || "event";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ticket = await getTicket(decodeURIComponent(token));
  // given back, or not a ticket: the page explains; nothing to save
  if (!ticket)
    return new Response("No ticket here", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });

  const [display, body, logo] = await fonts;
  const zone = ticket.timeZone;
  const cancelled = ticket.eventCancelled;
  const used = !!ticket.checkedInAt;
  const title = ticket.eventTitle;
  const titleSize = title.length > 48 ? 76 : title.length > 26 ? 96 : 120;
  const qr = `data:image/svg+xml;base64,${Buffer.from(ticket.qrSvg).toString("base64")}`;

  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COBALT,
        padding: "96px 72px 72px",
        fontFamily: "Archivo",
      }}
    >
      <img
        src={`data:image/png;base64,${logo}`}
        height={44}
        style={{
          height: 44,
          width: 176,
          objectFit: "contain",
          objectPosition: "left",
        }}
        alt=""
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          marginTop: 48,
          background: "white",
          borderRadius: 48,
          color: INK,
          position: "relative",
        }}
      >
        {/* the event */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "56px 56px 44px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Archivo Body",
              fontSize: 34,
              color: COBALT,
            }}
          >
            {`${ticket.clubName}, ${ticket.workspaceName}`}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: titleSize,
              lineHeight: 0.95,
              marginTop: 12,
              color: cancelled ? MUTED : INK,
              textDecoration: cancelled ? "line-through" : "none",
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 28,
              fontFamily: "Archivo Body",
              fontSize: 38,
              lineHeight: 1.35,
            }}
          >
            <div style={{ display: "flex" }}>{formatFullDate(ticket.startsAt, zone)}</div>
            <div style={{ display: "flex" }}>{formatTimeRange(ticket.startsAt, ticket.endsAt, zone)}</div>
            {ticket.location && <div style={{ display: "flex" }}>{ticket.location}</div>}
          </div>
        </div>

        {/* the tear line, with a notch punched at each end */}
        <div
          style={{
            display: "flex",
            height: 2,
            margin: "0 48px",
            borderTop: "4px dashed #d4d4d8",
          }}
        />
        <div style={{ display: "flex", position: "relative", height: 0 }}>
          <div
            style={{
              position: "absolute",
              left: -28,
              top: -28,
              width: 56,
              height: 56,
              borderRadius: 28,
              background: COBALT,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -28,
              top: -28,
              width: 56,
              height: 56,
              borderRadius: 28,
              background: COBALT,
            }}
          />
        </div>

        {/* the stub: the code, whose it is, and the door's stamp once used */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flex: 1,
            padding: "48px 56px 56px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
            }}
          >
            {cancelled ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 640,
                  height: 640,
                  color: STAMP,
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", fontSize: 96 }}>Cancelled</div>
                <div
                  style={{
                    display: "flex",
                    fontFamily: "Archivo Body",
                    fontSize: 36,
                    marginTop: 16,
                  }}
                >
                  This ticket no longer gets anyone in.
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  position: "relative",
                  width: 640,
                  height: 640,
                }}
              >
                <img src={qr} width={640} height={640} style={{ width: 640, height: 640, opacity: used ? 0.15 : 1 }} alt="" />
                {used && (
                  <div
                    style={{
                      position: "absolute",
                      display: "flex",
                      top: 0,
                      left: 0,
                      width: 640,
                      height: 640,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        transform: "rotate(-12deg)",
                        border: `8px solid ${STAMP}`,
                        borderRadius: 24,
                        background: "rgba(255,255,255,0.9)",
                        padding: "20px 44px",
                        color: STAMP,
                      }}
                    >
                      <div style={{ display: "flex", fontSize: 84, lineHeight: 1 }}>Checked in</div>
                      <div
                        style={{
                          display: "flex",
                          fontFamily: "Archivo Body",
                          fontSize: 36,
                          marginTop: 8,
                        }}
                      >
                        {formatTime(ticket.checkedInAt!, zone)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", fontSize: 56, marginTop: 28 }}>{ticket.attendeeName}</div>
            <div
              style={{
                display: "flex",
                fontFamily: "Archivo Body",
                fontSize: 30,
                color: MUTED,
                marginTop: 4,
              }}
            >
              {`Ticket ${ticket.registrationId.slice(0, 8).toUpperCase()}`}
            </div>
          </div>
          {!cancelled && !used && (
            <div
              style={{
                display: "flex",
                fontFamily: "Archivo Body",
                fontSize: 30,
                color: MUTED,
              }}
            >
              Show this at the door, screen brightness up.
            </div>
          )}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Archivo", data: display, weight: 800, style: "normal" },
        { name: "Archivo Body", data: body, weight: 500, style: "normal" },
      ],
    },
  );

  // the address is the ticket: never cached on the way, never indexed
  const headers = new Headers(image.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Disposition", `inline; filename="${fileSlug(title)}-ticket.png"`);
  return new Response(image.body, { status: 200, headers });
}
