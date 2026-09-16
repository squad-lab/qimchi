import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Rnd } from "react-rnd";

import Tooltip from "./Tooltip";

// A draggable, resizable modal with a list of sections down the left and the
// active section's content on the right. Help and Settings share it.

export interface ModalSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Sub-sections, listed indented under this one. */
  children?: ModalSection[];
}

type Accent = "amber" | "blue";

const ACCENT_CLASSES: Record<
  Accent,
  { header: string; iconBox: string; badge: string; active: string; activeIcon: string }
> = {
  amber: {
    header: "bg-amber-200 border-amber-300",
    iconBox: "bg-amber-100 border-amber-200",
    badge: "text-amber-700 bg-amber-50 border-amber-300/50",
    active: "bg-amber-50 text-amber-700 border-l-amber-500",
    activeIcon: "text-amber-600",
  },
  blue: {
    header: "bg-blue-100 border-blue-200",
    iconBox: "bg-blue-50 border-blue-200",
    badge: "text-blue-700 bg-blue-50 border-blue-300/50",
    active: "bg-blue-50 text-blue-700 border-l-blue-500",
    activeIcon: "text-blue-600",
  },
};

// Helper for z-index management, shared with the other floating modals.
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 2000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 2000) + 1;
  return w.__qimchi_modal_z;
};

interface SectionedModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Escape runs this instead of closing, when given (e.g. to clear a search first). */
  onEscape?: () => void;
  title: string;
  icon: React.ReactNode;
  shortcut?: string;
  accent: Accent;
  sections: ModalSection[];
  activeSection: string;
  onSelectSection: (id: string) => void;
  /** Extra header buttons, placed before the close button. */
  headerActions?: React.ReactNode;
  /** Spans both panes, directly under the header. */
  toolbar?: React.ReactNode;
  navLabel: string;
  contentRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

const SectionedModal = ({
  isOpen,
  onClose,
  onEscape,
  title,
  icon,
  shortcut,
  accent,
  sections,
  activeSection,
  onSelectSection,
  headerActions,
  toolbar,
  navLabel,
  contentRef,
  children,
}: SectionedModalProps) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const colors = ACCENT_CLASSES[accent];

  const bringToFront = () => {
    if (wrapperRef.current) wrapperRef.current.style.zIndex = String(getNextGlobalModalZ());
  };

  useEffect(() => {
    if (isOpen) bringToFront();
  }, [isOpen]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isOpen) return;
      (onEscape ?? onClose)();
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [isOpen, onClose, onEscape]);

  if (!isOpen) return null;

  const renderSection = (section: ModalSection, depth: number) => {
    const active = activeSection === section.id;
    return (
      <div key={section.id}>
        <button
          onClick={() => onSelectSection(section.id)}
          aria-current={active ? "page" : undefined}
          className={`w-full flex items-center gap-2.5 text-left text-sm font-semibold transition-all border-b border-gray-100 border-l-4 ${
            depth === 0 ? "px-4 py-3.5" : "pl-9 pr-4 py-2.5 text-[13px]"
          } ${
            active
              ? `${colors.active} shadow-inner`
              : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 border-l-transparent"
          }`}
        >
          <span className={active ? colors.activeIcon : "text-gray-400"}>{section.icon}</span>
          {section.label}
        </button>
        {section.children?.map((child) => renderSection(child, depth + 1))}
      </div>
    );
  };

  return (
    <div ref={wrapperRef} className="fixed inset-0 pointer-events-none">
      <Rnd
        default={{
          x: window.innerWidth / 2 - 455,
          y: window.innerHeight / 2 - 325,
          width: 910,
          height: 670,
        }}
        minWidth={500}
        minHeight={400}
        dragHandleClassName="drag-handle"
        bounds="parent"
        style={{ pointerEvents: "auto" }}
        onMouseDown={bringToFront}
        onPointerDown={bringToFront}
      >
        <div
          role="dialog"
          aria-label={title}
          className="bg-white rounded-xl shadow-2xl border border-gray-300 flex flex-col overflow-hidden w-full h-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`flex items-center justify-between px-4 py-2 border-b drag-handle cursor-move shrink-0 ${colors.header}`}
          >
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-lg border shadow-sm ${colors.iconBox}`}>{icon}</div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-800 tracking-tight">{title}</h2>
                {shortcut && (
                  <span
                    className={`text-[12px] font-mono font-bold px-1 py-0.5 rounded border opacity-90 ${colors.badge}`}
                  >
                    {shortcut}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {headerActions}
              <Tooltip content="Close modal" position="bottom">
                <button
                  onClick={onClose}
                  className="p-1.5 rounded hover:bg-gray-300 transition-colors"
                  title="Close modal"
                  aria-label="Close modal"
                >
                  <X size={16} className="text-red-600" />
                </button>
              </Tooltip>
            </div>
          </div>

          {toolbar && (
            <div className="shrink-0 border-b border-gray-200 bg-gray-50 p-2">{toolbar}</div>
          )}

          <div className="flex flex-1 min-h-0 bg-white">
            <nav
              aria-label={navLabel}
              className="w-48 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto"
            >
              {sections.map((section) => renderSection(section, 0))}
            </nav>
            <div className="flex min-w-0 flex-1 flex-col bg-white">
              <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
                {children}
              </div>
            </div>
          </div>
        </div>
      </Rnd>
    </div>
  );
};

export default SectionedModal;
