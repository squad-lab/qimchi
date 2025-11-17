import {
  Menu,
  ChevronLeft,
  FolderTree,
  NotebookPen,
  BadgeInfo,
  Lightbulb,
  Gitlab,
  Link,
  ScrollText,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// Local imports
import Notes from "./Notes";
import Explorer from "./Explorer";
import Metadata from "./Metadata";
import { TreeNode } from "./DirTree";
import { BasketItem } from "./Basket";
import { AttrData } from "./interfaces";
import { useSidebarStore } from "../stores/sidebarStore";
import Tooltip from "./Tooltip";
import { themeClasses } from "../theme";

// Type definitions for props
interface SidebarProps {
  defaultWidth?: number; // In percentage (0-100)
  onSelectNode: (node: TreeNode) => void;
  basketItems: BasketItem[];
  onAddToBasket: (item: BasketItem) => void;
  onRemoveBasketItem: (id: string) => void;
  onUpdateBasketItemAttributes: (itemId: string, attributes: AttrData) => void;
  onStartLoadingAttributes: (itemId: string) => void;
  loadingAttributes: Set<string>;
  onOpenNotes: (node: TreeNode) => void;
  notesSelectedItemId: string | null;
  onNotesSelectedItemChange: (itemId: string | null) => void;
  onCycleDataset?: (direction: "prev" | "next") => void; // For cycling through datasets
}

const NOTES_TIPS = (
  <div className="w-80 space-y-1 text-sm text-left">
    <ul className="list-disc list-inside">
      <li>Drag & drop dataset paths</li>
      <li>Send plot images to Notes</li>
      <li>Frontmatter saved in .md</li>
    </ul>
  </div>
);

const sectionButtonBaseClass =
  "text-lg font-semibold p-2 transition-colors w-full text-center";

const brandingLinks = [
  {
    href: "https://gitlab.com/squad-lab/qimchi/",
    label: "Open Qimchi on GitLab",
    Icon: Gitlab,
  },
  {
    href: "https://squad-lab.org/",
    label: "Visit squad-lab.org",
    Icon: Link,
  },
  {
    href: "https://gitlab.com/squad-lab/qimchi/-/blob/main/LICENSE",
    label: "View Qimchi License",
    Icon: ScrollText,
  },
];

const Sidebar = ({
  defaultWidth = 20,
  onSelectNode,
  basketItems,
  onAddToBasket,
  onRemoveBasketItem,
  onUpdateBasketItemAttributes,
  onStartLoadingAttributes,
  onOpenNotes,
  notesSelectedItemId,
  onNotesSelectedItemChange,
  onCycleDataset,
}: SidebarProps) => {
  // Use Zustand store for panel states
  const {
    sidebarCollapsed,
    explorerCollapsed,
    metadataCollapsed,
    notesCollapsed,
    brandingCollapsed,
    setSidebarCollapsed,
    setExplorerCollapsed,
    setMetadataCollapsed,
    setNotesCollapsed,
    setBrandingCollapsed,
  } = useSidebarStore();

  const handleSelectNode = (node: TreeNode) => {
    onSelectNode(node);
    // console.log("Selected node:", node);
  };

  const handleAddToBasket = (item: BasketItem) => {
    onAddToBasket(item);
  };

  return (
    <>
      {/* Sidebar collapse/expand button */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="p-2 rounded hover:bg-gray-200"
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {sidebarCollapsed ? <Menu size={15} /> : <ChevronLeft size={15} />}
      </button>
      {/* Sidebar */}
      <Panel
        defaultSize={defaultWidth}
        collapsible
        // TODOLATER: Remove if the skip is annoying.
        minSize={sidebarCollapsed ? 0 : 14}
        className={`${sidebarCollapsed ? "max-w-[0px]" : ""}`}
        style={{ display: sidebarCollapsed ? "none" : "block" }}
      >
        <div className="flex flex-col h-screen">
          <div className="flex-1 overflow-hidden">
            <PanelGroup direction="vertical" className="h-full">
              {/* Explorer */}
              <button
                onClick={() => setExplorerCollapsed(!explorerCollapsed)}
                className={`${sectionButtonBaseClass} ${
                  themeClasses.accentBg
                } ${themeClasses.accentHoverBg} ${
                  explorerCollapsed ? "mb-0" : "mb-0"
                }`}
                title={
                  explorerCollapsed ? "Expand Explorer" : "Collapse Explorer"
                }
              >
                <h2 className="flex items-center justify-center gap-2">
                  <FolderTree size={20} /> Explorer
                </h2>
              </button>
              <Panel
                order={1}
                collapsible
                className={"bg-gray-100" + (explorerCollapsed ? " p-2" : "")}
                style={{ display: explorerCollapsed ? "none" : "block" }}
              >
                <Explorer
                  onSelectNode={handleSelectNode}
                  basketItems={basketItems}
                  onAddToBasket={handleAddToBasket}
                  onRemoveBasketItem={onRemoveBasketItem}
                  onUpdateBasketItemAttributes={onUpdateBasketItemAttributes}
                  onStartLoadingAttributes={onStartLoadingAttributes}
                  onOpenNotes={onOpenNotes}
                  onCycleDataset={onCycleDataset}
                />
              </Panel>

              {/* Metadata */}
              <PanelResizeHandle
                className="h-1.5 bg-gray-300 hover:bg-blue-500 transition-colors"
                style={{ display: metadataCollapsed ? "none" : "block" }}
              />
              <button
                onClick={() => setMetadataCollapsed(!metadataCollapsed)}
                className={`${sectionButtonBaseClass} ${
                  themeClasses.accentBg
                } ${themeClasses.accentHoverBg} ${
                  metadataCollapsed ? "mb-0" : "mb-0"
                }`}
                title={
                  metadataCollapsed ? "Expand Metadata" : "Collapse Metadata"
                }
              >
                <h2 className="flex items-center justify-center gap-2">
                  <BadgeInfo size={21} /> Metadata
                </h2>
              </button>
              <Panel
                order={2}
                collapsible
                className={"bg-gray-100" + (notesCollapsed ? " p-2" : "")}
                style={{ display: metadataCollapsed ? "none" : "block" }}
              >
                <Metadata basketItems={basketItems} />
              </Panel>

              {/* Notes */}
              <PanelResizeHandle
                className="h-1.5 bg-gray-300 hover:bg-blue-500 transition-colors"
                style={{ display: notesCollapsed ? "none" : "block" }}
              />
              <button
                onClick={() => setNotesCollapsed(!notesCollapsed)}
                className={`${sectionButtonBaseClass} ${
                  themeClasses.accentBg
                } ${themeClasses.accentHoverBg} ${
                  notesCollapsed ? "mb-0" : "mb-0"
                }`}
                title={notesCollapsed ? "Expand Notes" : "Collapse Notes"}
              >
                <h2 className="relative flex items-center justify-center gap-2">
                  {/* Lightbulb tips for Notes */}
                  <div className="absolute left-2 top-1/2 transform -translate-y-1/2 z-10">
                    <Tooltip
                      content={NOTES_TIPS}
                      position="right"
                      className="p-2 text-gray-600 hover:text-yellow-600 hover:bg-yellow-200 rounded disabled:opacity-50 transition-colors"
                    >
                      <Lightbulb size={16} />
                    </Tooltip>
                  </div>
                  <NotebookPen size={20} /> Notes
                </h2>
              </button>
              <Panel
                order={3}
                collapsible
                className={"bg-gray-100" + (notesCollapsed ? " p-2" : "")}
                style={{ display: notesCollapsed ? "none" : "block" }}
              >
                <Notes
                  basketItems={basketItems}
                  isCollapsed={notesCollapsed}
                  selectedItemId={notesSelectedItemId}
                  onSelectedItemChange={onNotesSelectedItemChange}
                />
              </Panel>
            </PanelGroup>
          </div>

          {/* Branding Footer */}
          {!brandingCollapsed && (
            <div className="flex-shrink-0 bg-gradient-to-b from-slate-50 via-white to-slate-100 border-t-2 border-slate-300 shadow-lg">
              <div className="px-6 py-3 space-y-3">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-center gap-5 pb-2 border-b border-slate-200">
                    <a
                      href="https://squad-lab.org/"
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Visit SQUAD Lab website"
                      className="transition-all duration-200"
                    >
                      <img
                        src="/SQUAD-logo-dark.webp"
                        alt="SQUAD Lab logo"
                        className="h-9 sm:h-11 w-auto object-contain filter drop-shadow-sm hover:drop-shadow-md"
                        loading="lazy"
                      />
                    </a>
                    {/* Vertical Separator */}
                    <div className="h-8 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent hidden sm:block" />
                    <a
                      href="https://www.fz-juelich.de/"
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Visit Forschungszentrum Jülich website"
                      className="transition-all duration-200"
                    >
                      <img
                        src="/FZJ-logo.svg"
                        alt="FZJ logo"
                        className="h-8 sm:h-10 w-auto object-contain filter drop-shadow-sm hover:drop-shadow-md"
                        loading="lazy"
                      />
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-slate-100 to-slate-50 rounded-full border border-slate-200 shadow-sm">
                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="font-bold text-sm text-slate-800 tracking-tight">
                        Qimchi v0.2
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {brandingLinks.map(({ href, label, Icon }) => (
                        <a
                          key={href}
                          href={href}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={label}
                          className="p-2.5 rounded-lg bg-blue-50/50 hover:bg-gradient-to-br hover:from-blue-100 hover:to-indigo-100 active:bg-blue-200 transition-all duration-300 text-blue-600 hover:text-blue-700 hover:shadow-md border border-blue-100 hover:border-blue-200"
                        >
                          <Icon size={17} strokeWidth={1.8} />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setBrandingCollapsed(true)}
                className="w-full py-1.5 text-[9px] uppercase tracking-wider font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 border-t border-slate-200 transition-all duration-200"
                title="Collapse Footer"
              >
                Collapse Footer
              </button>
            </div>
          )}
          {brandingCollapsed && (
            <button
              onClick={() => setBrandingCollapsed(false)}
              className="flex-shrink-0 w-full py-2 text-[9px] uppercase tracking-wider font-medium text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 border-t-2 border-slate-300 transition-all duration-200 shadow-sm"
              title="Expand Footer"
            >
              Expand Footer
            </button>
          )}
        </div>
      </Panel>
      <PanelResizeHandle
        className="w-1.5 bg-gray-300 hover:bg-blue-500 transition-colors"
        style={{ display: sidebarCollapsed ? "none" : "block" }}
      />
    </>
  );
};

export default Sidebar;
