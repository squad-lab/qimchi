import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isEditableTarget } from "../../hooks/useGlobalShortcuts";
import { usePlotStore } from "../../stores/plotStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { engineeringFormatter, type AxisUnitMeta } from "../../utils/engineeringFormat";
import {
  MARKER_KIND_LABELS,
  MAX_MARKERS,
  markerAtSameSpot,
  markerSetKey,
  nudgeMarker,
  type MarkerKind,
  type NudgeKey,
  type PlotMarker,
} from "../../utils/plotMarkers";

type PreviewJson = { data?: unknown[]; layout?: unknown } | null;

export type MarkerFormat = { x: (value: number) => string; y: (value: number) => string };

export const OBLIQUE_MARKER_MESSAGE = "Markers are not available for oblique cuts.";

const NO_MARKERS: PlotMarker[] = [];

const numbers = (values: unknown): number[] => (Array.isArray(values) ? values.map(Number) : []);

/** Extract numeric samples from the preview's first trace. */
const samplesOf = (preview: PreviewJson) => {
  const trace = preview?.data?.[0] as { x?: unknown; y?: unknown } | undefined;
  return { x: numbers(trace?.x), y: numbers(trace?.y) };
};

const NUDGE_KEYS: Record<string, NudgeKey> = {
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
};

/** Handle marker arrows only when the page or LineCut panel has focus. */
const arrowsAreOurs = (target: EventTarget | null) =>
  target === document.body ||
  target === document.documentElement ||
  (target instanceof Element && target.closest("[data-linecut-panel]") !== null);

const unitFormatter = (definition: AxisUnitMeta | undefined) => (value: number) =>
  engineeringFormatter(definition, [value])(value);

/** Manage LineCut marker sets, tools, selection and keyboard shortcuts. */
export function useLineCutMarkers({
  plotId,
  preview,
  active,
  enabled,
  notify,
}: {
  plotId: string | null;
  preview: PreviewJson;
  /** Whether LineCut is active for this plot. */
  active: boolean;
  /** Whether the current cut supports markers; false for oblique cuts. */
  enabled: boolean;
  notify: (message: string, type: "info" | "warning") => void;
}) {
  const key = enabled && preview ? markerSetKey(preview.layout) : null;
  const markers =
    usePlotStore((state) =>
      plotId && key ? state.plotStates[plotId]?.linecut_markers?.[key] : undefined,
    ) ?? NO_MARKERS;
  const shiftStep = useSettingsStore((state) => state.settings.plots.lineCutMarkerStep);
  const [tool, setTool] = useState<MarkerKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedId = markers.some((marker) => marker.id === selected) ? selected : null;

  // Keep formatter references stable while the units are unchanged.
  const units = (preview?.layout as { meta?: { qimchi_units?: Record<string, AxisUnitMeta> } })
    ?.meta?.qimchi_units;
  const unitsKey = JSON.stringify([units?.x ?? null, units?.y ?? null]);
  const format = useMemo<MarkerFormat>(() => {
    const [x, y] = JSON.parse(unitsKey) as [AxisUnitMeta | null, AxisUnitMeta | null];
    return { x: unitFormatter(x ?? undefined), y: unitFormatter(y ?? undefined) };
  }, [unitsKey]);

  useEffect(() => {
    if (!active || !enabled) setTool(null);
    if (!active) setSelected(null);
  }, [active, enabled]);

  const save = useCallback(
    (next: PlotMarker[]) => {
      if (plotId && key) usePlotStore.getState().setLineCutMarkers(plotId, key, next);
    },
    [plotId, key],
  );

  const add = useCallback(
    (marker: PlotMarker) => {
      // Select the existing marker instead of adding a duplicate of the same kind.
      const existing = markerAtSameSpot(markers, marker);
      if (existing) {
        setSelected(existing.id);
        notify(
          `There is already a ${MARKER_KIND_LABELS[marker.kind].toLowerCase()} there.`,
          "info",
        );
        return;
      }
      if (markers.length >= MAX_MARKERS) {
        notify(
          `A LineCut preview holds up to ${MAX_MARKERS} markers. Remove one to add another.`,
          "warning",
        );
        return;
      }
      save([...markers, marker]);
      setSelected(marker.id);
    },
    [markers, notify, save],
  );

  const remove = useCallback(
    (id: string) => {
      save(markers.filter((marker) => marker.id !== id));
      setSelected((current) => (current === id ? null : current));
    },
    [markers, save],
  );

  const move = useCallback(
    (moved: PlotMarker) => {
      save(markers.map((marker) => (marker.id === moved.id ? moved : marker)));
    },
    [markers, save],
  );

  const clear = useCallback(() => {
    save([]);
    setSelected(null);
  }, [save]);

  const toggleTool = useCallback((kind: MarkerKind) => {
    setTool((current) => (current === kind ? null : kind));
  }, []);

  const stateRef = useRef({ tool, selectedId, markers, remove, move, preview, shiftStep });
  stateRef.current = { tool, selectedId, markers, remove, move, preview, shiftStep };

  // Handle marker shortcuts before app shortcuts to avoid also closing the
  // plot, exiting LineCut or triggering navigation.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "escape" && isEditableTarget(event.target)) return;
      const current = stateRef.current;
      const stop = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const nudgeKey = NUDGE_KEYS[key];
      if (nudgeKey && current.selectedId && arrowsAreOurs(event.target)) {
        const marker = current.markers.find((candidate) => candidate.id === current.selectedId);
        const curve = samplesOf(current.preview);
        const nudge = (from: PlotMarker, count: number) =>
          nudgeMarker(from, nudgeKey, curve, count);
        let moved = marker && nudge(marker, event.shiftKey ? current.shiftStep : 1);
        if (!moved) return;
        stop();
        // Skip positions occupied by another marker of the same kind.
        while (moved && markerAtSameSpot(current.markers, moved)) {
          const next = nudge(moved, 1);
          moved = next && (next.x !== moved.x || next.y !== moved.y) ? next : null;
        }
        if (moved) current.move(moved);
        return;
      }
      if (event.repeat) return;
      if ((key === "delete" || key === "backspace") && current.selectedId) {
        stop();
        current.remove(current.selectedId);
      } else if (key === "escape" && current.tool) {
        stop();
        setTool(null);
      } else if (key === "escape" && current.selectedId) {
        stop();
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [active]);

  return {
    markers,
    /** Markers can be shown and placed on the current preview. */
    available: key !== null,
    enabled,
    tool,
    toggleTool,
    selectedId,
    select: setSelected,
    add,
    move,
    remove,
    clear,
    format,
  };
}

export type LineCutMarkersState = ReturnType<typeof useLineCutMarkers>;
