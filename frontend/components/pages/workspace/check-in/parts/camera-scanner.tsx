"use client";

import { CameraOff, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type CameraState = "starting" | "running" | "denied" | "unavailable";

/**
 * The back camera, reading QR codes. Calls `onCode` with each code it reads
 * (the page decides what to do with repeats). html5-qrcode is loaded in the
 * browser only, and the camera is released when the page closes.
 */
export function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const elementId = `scanner-${useId().replace(/:/g, "")}`;
  const [state, setState] = useState<CameraState>("starting");
  // the latest handler, without restarting the camera when it changes
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    let cancelled = false;
    let scanner: import("html5-qrcode").Html5Qrcode | null = null;

    (async () => {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      if (cancelled) return;
      scanner = new Html5Qrcode(elementId, { verbose: false, formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
      try {
        await scanner.start(
          { facingMode: "environment" },
          // the whole frame is read, not just a box: a ticket held close fills the view.
          // 10 reads a second is plenty at a door.
          { fps: 10 },
          (text) => onCodeRef.current(text),
          () => {}, // "no code in this frame": not an error
        );
        if (cancelled) await scanner.stop().catch(() => {});
        else setState("running");
      } catch (error) {
        if (cancelled) return;
        const message = String((error as Error)?.message ?? error);
        setState(/permission|denied|notallowed/i.test(message) ? "denied" : "unavailable");
      }
    })();

    return () => {
      cancelled = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, [elementId]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-ink">
      {/* the library sizes the video itself; stretching it would misalign what it reads */}
      <div id={elementId} className="size-full [&_video]:mx-auto [&_video]:max-h-full" />
      {state === "running" && (
        // a guide for where to hold the ticket; purely visual, the whole frame is read
        <div aria-hidden className="pointer-events-none absolute inset-[12%] rounded-2xl border-2 border-white/70" />
      )}
      {state === "starting" && (
        <div className="absolute inset-0 grid place-items-center text-white/80" role="status">
          <span className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
            Starting the camera
          </span>
        </div>
      )}
      {(state === "denied" || state === "unavailable") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white" role="alert">
          <CameraOff className="size-8 text-white/70" aria-hidden />
          <p className="font-semibold">
            {state === "denied" ? "Camera access is blocked" : "No camera available"}
          </p>
          <p className="text-sm text-white/75">
            {state === "denied"
              ? "Allow camera access for this site in your browser settings, then reload. Meanwhile, find people by name."
              : "This device has no camera Muster can use. Find people by name instead."}
          </p>
        </div>
      )}
    </div>
  );
}
