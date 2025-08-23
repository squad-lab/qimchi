import React from "react";

// Local imports
import IndividualPlot from "./Plots/IndividualPlot";
import type { PlotConfiguration } from "./interfaces";
import usePainterStore from "../stores/painterStore";

interface PlotContainerProps {
  plotConfigs: PlotConfiguration[];
  className?: string;
  onRemovePlot: (id: string) => void;
  // widthPercent: number from 0..100 used as each plot's width
  widthPercent?: number;
  // Optional per-plot overrides keyed by plot id
  perPlotWidthMap?: Record<string, number>;
}

const PlotContainer: React.FC<PlotContainerProps> = ({
  plotConfigs,
  className = "",
  onRemovePlot,
  widthPercent,
  perPlotWidthMap,
}) => {
  const setShiftHeld = usePainterStore((s) => s.setShiftHeld);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [setShiftHeld]);
  if (plotConfigs.length === 0) {
    return (
      <div
        className={`flex items-center justify-center h-64 bg-gray-50 rounded-lg ${className}`}
      >
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">No plots to display</p>
          <p className="text-sm">
            Use the Plot Composer to create visualizations
          </p>
        </div>
      </div>
    );
  }

  const defaultPercent = widthPercent && widthPercent > 0 ? widthPercent : 50;
  // NOTE: Tailwind `gap-2` equals 0.5rem (8px at 16px root). Subtract a small gap
  // amount from the percent width to avoid wrapping when two items use 50%.
  const GAP_PX = 8;

  return (
    <div className={`relative ${className}`}>
      <div className="flex flex-wrap gap-2 p-0">
        {plotConfigs.map((config) => {
          const pct =
            perPlotWidthMap && perPlotWidthMap[config.id]
              ? perPlotWidthMap[config.id]
              : defaultPercent;
          // NOTE: Use calc to subtract a small fixed gap so items don't wrap due to
          // flex gaps, borders or rounding errors.
          const effective = `calc(${pct}% - ${GAP_PX}px)`;
          return (
            <div
              key={config.id}
              className="flex-grow"
              style={{
                flexBasis: effective,
                maxWidth: effective,
                boxSizing: "border-box",
              }}
            >
              <IndividualPlot config={config} onRemove={onRemovePlot} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlotContainer;
