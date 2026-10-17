import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Rnd } from "react-rnd";

import { fitToWindow, type Box } from "../../utils/keepInWindow";

const WIDTH = 616;
const HEIGHT = 462;
const MARGIN = 12;

// Restore the card's last position and size within this session.
let lastBox: Box | null = null;

const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;

/** Place the card beside the plot, constrained to the available window space. */
const initialBox = (anchor: HTMLElement | null): Box => {
  // Refit positions saved in a larger window.
  if (lastBox) return fitToWindow(lastBox, MIN_WIDTH, MIN_HEIGHT);
  const height = Math.max(MIN_HEIGHT, Math.min(HEIGHT, window.innerHeight - 2 * MARGIN));
  const rect = anchor?.getBoundingClientRect();
  if (!rect) {
    return { x: MARGIN, y: MARGIN, width: Math.min(WIDTH, window.innerWidth - 2 * MARGIN), height };
  }
  const roomRight = window.innerWidth - rect.right - 2 * MARGIN;
  const roomLeft = rect.left - 2 * MARGIN;
  const onRight = roomRight >= roomLeft;
  const width = Math.max(MIN_WIDTH, Math.min(WIDTH, onRight ? roomRight : roomLeft));
  let x = onRight ? rect.right + MARGIN : rect.left - width - MARGIN;
  let y = rect.top;
  x = Math.min(Math.max(x, MARGIN), window.innerWidth - width - MARGIN);
  y = Math.min(Math.max(y, MARGIN), window.innerHeight - height - MARGIN);
  return { x, y, width, height };
};

type Props = {
  /** The plot tile the card opens beside. */
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

/** A draggable, resizable LineCut card rendered outside the plot's clipping area. */
const LineCutPopup = ({ anchorRef, children }: Props) => {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    setBox(initialBox(anchorRef.current));
  }, [anchorRef]);

  // Until the user places it, the card follows its plot when the Viewer's
  // layout moves the plot (a new plot, a width change, a resized window).
  // Preserve manual placement while keeping the card inside the window.
  useEffect(() => {
    let frame = 0;
    let seen = "";
    const follow = () => {
      frame = requestAnimationFrame(follow);
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const windowSize = `${window.innerWidth},${window.innerHeight}`;
      const key = lastBox ? windowSize : `${rect.left},${rect.top},${rect.width},${windowSize}`;
      if (key === seen) return;
      if (seen) setBox(initialBox(anchorRef.current));
      seen = key;
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [anchorRef]);

  const place = (next: Box) => {
    lastBox = next;
    setBox(next);
  };

  if (!box) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1100]">
      <Rnd
        position={{ x: box.x, y: box.y }}
        size={{ width: box.width, height: box.height }}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        bounds="parent"
        dragHandleClassName="linecut-popup-handle"
        style={{ pointerEvents: "auto" }}
        onDragStop={(_event, drag) => place({ ...box, x: drag.x, y: drag.y })}
        onResizeStop={(_event, _direction, element, _delta, position) =>
          place({
            x: position.x,
            y: position.y,
            width: element.offsetWidth,
            height: element.offsetHeight,
          })
        }
      >
        <div
          role="dialog"
          aria-label="LineCut"
          data-qimchi-popup
          className="flex h-full w-full flex-col overflow-hidden rounded-lg border-2 border-gray-300 bg-white shadow-2xl"
        >
          {children}
        </div>
      </Rnd>
    </div>,
    document.body,
  );
};

export default LineCutPopup;
