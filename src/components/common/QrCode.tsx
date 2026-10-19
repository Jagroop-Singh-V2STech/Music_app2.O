import { useMemo } from "react";
import { encode } from "uqr";

/** One SVG path of the dark modules, drawn dark-on-white so every phone camera reads it. */
// Lower error correction ("L") makes long links less dense, so they stay easy for phone cameras to read.
export function QrCode({ value, label = "QR code", ecc = "M" }: { value: string; label?: string; ecc?: "L" | "M" }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(value, { ecc, border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
    return { size, path: d };
  }, [ecc, value]);
  return (
    <svg className="jam-qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#10140a" />
    </svg>
  );
}

/** Longest URL we'll put in a QR code; beyond this the code gets too dense for phone cameras. */
export const QR_MAX_LENGTH = 1500;
