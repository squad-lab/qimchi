import {
  Menu,
  ChevronLeft,
  FolderTree,
  NotebookPen,
  BadgeInfo,
} from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// Local imports
import Notes from "./Notes";
import Explorer from "./Explorer";
import Metadata from "./Metadata";
import BrandingFooter from "./BrandingFooter";
import { TreeNode } from "./treeUtils";
import { BasketItem } from "./Basket";
import { AttrData } from "./interfaces";
import { useSidebarStore } from "../stores/sidebarStore";
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
  onOpenSampleNotes?: (node: TreeNode) => void;
  notesSelectedItemId: string | null;
  onNotesSelectedItemChange: (itemId: string | null) => void;
  onCycleDataset?: (direction: "prev" | "next") => void; // For cycling through datasets
  onOpenHelp?: () => void; // For opening the Help modal
}

const sectionButtonBaseClass =
  "text-lg font-semibold p-2 transition-colors w-full text-center";

const Sidebar = ({
  defaultWidth = 20,
  onSelectNode,
  basketItems,
  onAddToBasket,
  onRemoveBasketItem,
  onUpdateBasketItemAttributes,
  onStartLoadingAttributes,
  onOpenNotes,
  onOpenSampleNotes,
  notesSelectedItemId,
  onNotesSelectedItemChange,
  onCycleDataset,
  onOpenHelp,
}: SidebarProps) => {
  // Use Zustand store for panel states
  const {
    sidebarCollapsed,
    explorerCollapsed,
    metadataCollapsed,
    notesCollapsed,
    setSidebarCollapsed,
    setExplorerCollapsed,
    setMetadataCollapsed,
    setNotesCollapsed,
  } = useSidebarStore();

  const handleSelectNode = (node: TreeNode) => {
    onSelectNode(node);
    // console.log("Selected node:", node);
  };

  const handleAddToBasket = (item: BasketItem) => {
    onAddToBasket(item);
  };

  const handleOpenNotes = (node: TreeNode) => {
    // Ensure sidebar and Notes panel are visible before opening notes
    setSidebarCollapsed(false);
    setNotesCollapsed(false);
    onOpenNotes(node);
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
        minSize={sidebarCollapsed ? 0 : 18}
        className={`${sidebarCollapsed ? "max-w-0" : ""}`}
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
                  onOpenNotes={handleOpenNotes}
                  onOpenSampleNotes={onOpenSampleNotes}
                  onCycleDataset={onCycleDataset}
                  onOpenHelp={onOpenHelp}
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
                <h2 className="flex items-center justify-center gap-2">
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
          <BrandingFooter />
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
