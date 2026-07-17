"use client";

import * as React from "react";
import { Minus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import type { Field } from "../types";

// ════════════════════════════════════════════════════════════════════════════
// Barcode and QR cells.
//
// These fields hold NO value of their own — they point at another field and draw
// its value. The database has always agreed: barcode/qr are in READ_ONLY and
// excluded from swamp_writable_keys, so a write is refused. What was missing was
// anything producing a value to draw; swamp_field_catalog now resolves the pointer
// (20260716040000_barcode_qr.sql), so `value` here is the SOURCE field's value,
// already merged into record.data by the query engine.
//
// ── Why two dependencies ──
//
// qrcode and jsbarcode are exactly what NocoDB uses (nc-gui/package.json). Neither
// is a few lines of our own: a QR code needs Reed-Solomon error correction over
// GF(256) plus mode/mask selection, and getting it subtly wrong produces a code
// that scans on your phone and not on the customer's. Both are imported
// DYNAMICALLY, so they cost nothing to anyone who has no barcode field — which is
// almost everyone.
//
// ── Limits ──
//
// NocoDB refuses to render a QR over 2000 chars and a barcode over 100, and says
// so rather than drawing something unscannable. Same here: a barcode of a 5,000
// character note is not a barcode, it's a smear.
// ════════════════════════════════════════════════════════════════════════════

const QR_MAX = 2000;
const BARCODE_MAX = 100;

function Empty() {
  return <Minus className="size-3.5 text-muted-foreground/30" />;
}

function Unrenderable({ text }: { text: string }) {
  return (
    <span className="text-[11px] text-muted-foreground" title={text}>
      {text}
    </span>
  );
}

/** A QR code as a data-URL img. */
function Qr({ value, size }: { value: string; size: number }) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setFailed(false);

    void import("qrcode")
      .then((m) => m.default.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: size }))
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setFailed(true));

    return () => {
      alive = false;
    };
  }, [value, size]);

  if (failed) return <Unrenderable text="Can't encode" />;
  if (!src) return null;

  // A data: URL generated in the browser. next/image exists to optimize and cache
  // remote images; handing it bytes we just made would be a round trip for nothing.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={`QR code for ${value}`} width={size} height={size} />;
}

/** A barcode drawn into an inline SVG. */
function Barcode({
  value,
  format,
  height,
}: {
  value: string;
  format: string;
  height: number;
}) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setFailed(false);

    void import("jsbarcode")
      .then((m) => {
        if (!alive || !ref.current) return;
        // Throws when the value is invalid FOR THE CHOSEN FORMAT — letters in an
        // EAN13, say. That's a legitimate thing for a user to do by accident, so
        // it's caught and reported rather than left to break the grid.
        m.default(ref.current, value, {
          format,
          displayValue: false,
          height,
          margin: 0,
          background: "transparent",
        });
      })
      .catch(() => alive && setFailed(true));

    return () => {
      alive = false;
    };
  }, [value, format, height]);

  if (failed) {
    return <Unrenderable text={`Not a valid ${format}`} />;
  }
  return <svg ref={ref} role="img" aria-label={`Barcode for ${value}`} />;
}

export function BarcodeCell({ field, value }: { field: Field; value: unknown }) {
  const [open, setOpen] = React.useState(false);

  const text = value == null ? "" : String(value);
  const isQr = field.type === "qr";
  const format = field.options.barcodeFormat ?? "CODE128";

  // No source field configured, or the source is empty. A barcode with nothing to
  // encode is blank, not broken.
  if (!text) return <Empty />;

  const tooLong = isQr ? text.length > QR_MAX : text.length > BARCODE_MAX;
  if (tooLong) {
    return (
      <Unrenderable
        text={isQr ? `Too long to encode (${text.length})` : `Too long (${text.length})`}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-full items-center outline-none"
        aria-label={`${isQr ? "QR code" : "Barcode"} for ${text} — click to enlarge`}
      >
        {isQr ? <Qr value={text} size={22} /> : <Barcode value={text} format={format} height={22} />}
      </button>

      {/* A 22px barcode is a decoration; you scan the big one. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle className="text-[15px]">{field.name}</DialogTitle>
          <div className="flex flex-col items-center gap-3 py-2">
            {isQr ? (
              <Qr value={text} size={240} />
            ) : (
              <Barcode value={text} format={format} height={90} />
            )}
            <span className="break-all text-center text-[13px] text-muted-foreground">
              {text}
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
