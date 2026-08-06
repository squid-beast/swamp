"use client";

import * as React from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { divIcon, type LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Field, Record_ } from "../types";

// ════════════════════════════════════════════════════════════════════════════
// Map — markers from a `coordinates` field.
//
// This module is ALWAYS loaded via next/dynamic({ ssr: false }) from the
// workspace: Leaflet touches `window` at import time and would crash SSR, and
// dynamic() also keeps its ~52 kB gz in a chunk only map views pay for.
//
// Coordinates are stored as "lat,lng" text — the same shape the import
// inference recognises (engine/inference.ts). Parse that one format; anything
// else simply isn't on the map, like an undated record isn't on the calendar.
//
// Tiles are OpenStreetMap. Attribution is required by their licence and stays.
// Their tile-usage policy discourages heavy production traffic — a paid tile
// URL is a config value to swap in docs/GUIDE.md, not a code change.
// ════════════════════════════════════════════════════════════════════════════

function parseCoords(value: unknown): [number, number] | null {
  if (typeof value !== "string") return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

// A CSS marker in the brand colour — no image assets, so no Leaflet default-icon
// path fixups (the classic broken-marker bug with bundlers).
const markerIcon = divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:9999px;background:hsl(var(--brand));border:2px solid white;box-shadow:0 1px 4px rgb(0 0 0 / .4)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export default function MapView({
  fields,
  records,
  coordField,
  onExpand,
}: {
  fields: Field[];
  records: Record_[];
  coordField: Field;
  onExpand: (recordId: string) => void;
}) {
  const primary = fields.find((f) => f.isPrimary);

  const points = React.useMemo(
    () =>
      records.flatMap((r) => {
        const coords = parseCoords(r.data[coordField.key]);
        return coords ? [{ record: r, coords }] : [];
      }),
    [records, coordField]
  );

  const bounds: LatLngBoundsExpression | undefined = points.length
    ? (points.map((p) => p.coords) as LatLngBoundsExpression)
    : undefined;

  return (
    <div className="min-h-0 flex-1" data-testid="map-view">
      <MapContainer
        // key on the bounds so a data change re-fits — MapContainer options are
        // immutable after mount by design.
        key={points.length ? "data" : "empty"}
        bounds={bounds}
        center={points.length ? undefined : [20, 0]}
        zoom={points.length ? undefined : 2}
        className="h-full w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map(({ record, coords }) => (
          <Marker key={record.id} position={coords} icon={markerIcon}>
            <Popup>
              <button
                onClick={() => onExpand(record.id)}
                className="text-[13px] font-medium underline-offset-2 hover:underline"
              >
                {primary ? String(record.data[primary.key] ?? "Open record") : "Open record"}
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
