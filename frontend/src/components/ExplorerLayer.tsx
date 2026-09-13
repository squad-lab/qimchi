import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

interface ExplorerLayerProps {
  expanded: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Keep the full-window Explorer out of react-resizable-panels' DOM subtree.
 *
 * WebView2 can retain the panel's hit-testing/compositor state for a fixed
 * descendant after it grows beyond the panel. The surface still paints, but
 * some controls stop receiving useful clicks. Portalling the expanded layer
 * to body gives it the same viewport-sized hit-test surface that it paints.
 */
const ExplorerLayer = ({ expanded, style, children }: ExplorerLayerProps) => {
  const layer = (
    <div
      data-explorer-layer={expanded ? "expanded" : "compact"}
      className={expanded ? "fixed inset-0 z-[1500] pointer-events-auto bg-gray-100" : "h-full"}
      style={style}
    >
      {children}
    </div>
  );

  return expanded ? createPortal(layer, document.body) : layer;
};

export default ExplorerLayer;
