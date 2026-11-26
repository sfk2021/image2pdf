"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  count: number; // images already in the app
  max: number;
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallback: () => void; // use the phone's own camera app instead
};

async function openStream(facing: "environment" | "user") {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
      throw e;
    }
    // some phones reject the exact constraints: try the plain camera
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

export default function CameraCapture({ count, max, onCapture, onClose, onFallback }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const thumbRef = useRef("");

  // Always call the latest callbacks without restarting the camera
  const onCaptureRef = useRef(onCapture);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onCloseRef.current = onClose;
  });

  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const [thumb, setThumb] = useState("");
  const [shots, setShots] = useState(0);

  const full = count >= max;

  // Start / restart the camera when the facing changes
  useEffect(() => {
    let cancelled = false;

    async function start() {
      setReady(false);
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "This browser can't open the camera here. Camera access needs a secure (https) page."
        );
        return;
      }

      // give the previous camera a moment to release (needed on iPhone)
      await new Promise((r) => setTimeout(r, 150));
      if (cancelled) return;

      try {
        const stream = await openStream(facing);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings and try again."
            : "Could not start the camera on this device."
        );
      }
    }

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  // Lock page scroll and close on Escape (runs once)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Free the last thumbnail only when the camera closes
  useEffect(() => {
    return () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    };
  }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v || !ready || full || busyRef.current || !v.videoWidth) return;
    busyRef.current = true;

    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);

    // instant feedback, before the image is encoded
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    if (navigator.vibrate) navigator.vibrate(30);

    canvas.toBlob(
      (blob) => {
        busyRef.current = false;
        if (!blob) return;

        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCaptureRef.current(file);

        if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
        const url = URL.createObjectURL(blob);
        thumbRef.current = url;
        setThumb(url);
        setShots((s) => s + 1);
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <div className="cam" role="dialog" aria-label="Camera">
      <video
        ref={videoRef}
        className={`cam-video ${facing === "user" ? "mirror" : ""}`}
        autoPlay
        playsInline
        muted
        onPlaying={() => setReady(true)}
        onLoadedData={() => setReady(true)}
      />
      {flash && <div className="cam-flash" />}

      <div className="cam-top">
        <span className="cam-pill">
          {count} / {max}
        </span>
        {!error && (
          <button
            className="cam-round"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            disabled={!ready}
            aria-label="Switch camera"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <div className="cam-error">
          <p>{error}</p>
          <button className="cam-btn" onClick={onFallback}>
            Use phone camera app
          </button>
          <button className="cam-btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}

      {!error && full && (
        <div className="cam-banner">Limit of {max} images reached. Tap Done.</div>
      )}

      {!error && (
        <div className="cam-bottom">
          <div className="cam-side">
            {thumb && (
              <div className="cam-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb} alt="Last photo" />
                <span>{shots}</span>
              </div>
            )}
          </div>

          <button
            className="cam-shutter"
            onClick={shoot}
            disabled={!ready || full}
            aria-label="Take photo"
          >
            <span />
          </button>

          <div className="cam-side right">
            <button className="cam-done" onClick={onClose}>
              {shots > 0 ? `Done (${shots})` : "Close"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}