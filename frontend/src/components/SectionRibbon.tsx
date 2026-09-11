import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

// Local imports
import Tooltip from "./Tooltip";

interface SectionRibbonProps {
  label: string; // Section name -- shown in the icon's tooltip, not on screen
  Icon: LucideIcon;
  count?: number; // Rendered as a badge on the icon when > 0
  // A collapsed section is far shorter than the stack of controls, so it lays
  // the same ribbon out as a slim strip instead of clipping it.
  orientation?: "vertical" | "horizontal";
  onToggle?: () => void;
  children?: ReactNode; // Control buttons, in order
}

// Shared button styling for anything placed in a ribbon.
export const ribbonButtonClass =
  "qimchi-dark-hover-plain flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed";

// The control ribbon used by Basket, Composer and Viewer, modelled on the plot
// card's side panel: section icon first, controls after it. Unlike the plot's,
// this one is always visible -- these controls are the only way to act on the
// section, so they must not be hidden behind a hover.
const SectionRibbon = ({
  label,
  Icon,
  count,
  orientation = "vertical",
  onToggle,
  children,
}: SectionRibbonProps) => {
  const isVertical = orientation === "vertical";

  return (
    <div
      className={`${
        isVertical
          ? "flex w-11 shrink-0 flex-col items-center gap-1 rounded-r-lg border-l border-gray-200 bg-gray-50 py-2"
          : "flex w-full flex-row items-center gap-1 rounded-lg bg-gray-50 px-2 py-1"
      } ${onToggle ? "cursor-pointer" : ""}`}
      onClick={(event) => {
        // Controls in the ribbon keep their own behaviour; the surrounding
        // title, spacer and empty ribbon area toggle the section.
        if (onToggle && !(event.target as Element).closest("button")) onToggle();
      }}
    >
      <Tooltip
        content={`${count === undefined ? label : `${label} (${count})`}${
          onToggle ? ` — click to ${isVertical ? "collapse" : "expand"}` : ""
        }`}
        position="left"
      >
        <div className="relative flex h-7 w-7 items-center justify-center text-gray-700">
          <Icon size={18} />
          {count !== undefined && count > 0 && (
            <span className="absolute -bottom-1 -right-1 min-w-[15px] rounded-full bg-gray-700 px-1 text-center text-[9px] font-medium leading-[15px] text-white">
              {count}
            </span>
          )}
        </div>
      </Tooltip>

      {/* Collapsed: the icon stays at the left edge and the controls sit on the
          right, where they are in the expanded ribbon. */}
      {!isVertical && <div className="flex-1" />}

      <div className={`shrink-0 bg-gray-300 ${isVertical ? "h-px w-6" : "h-6 w-px"}`} />

      {children}
    </div>
  );
};

export default SectionRibbon;
