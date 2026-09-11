import { Panel, PanelResizeHandle } from "react-resizable-panels";

// Local imports
import Notes from "./Notes";
import Explorer from "./Explorer";
import Metadata from "./Metadata";
import BrandingFooter from "./BrandingFooter";
import { TreeNode } from "./treeUtils";
import { BasketItem } from "./Basket";
import { AttrData } from "./interfaces";
import { useSidebarStore, SidebarSection, explorerSections } from "../stores/sidebarStore";

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
}

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
}: SidebarProps) => {
  // Use Zustand store for panel states
  const {
    sidebarCollapsed,
    activeSection,
    explorerExpanded,
    setSidebarCollapsed,
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

  // Sections stay mounted and are hidden with `display: none` so switching tabs
  // keeps DirTree's tree, the metadata search and unsaved note text alive.
  const sectionStyle = (id: SidebarSection) => ({
    display: activeSection === id ? "block" : "none",
  });

  // Explorer and Live are the same component in two modes, so the pane is shown
  // for either tab (see SidebarSection in stores/sidebarStore).
  const explorerStyle = {
    display: activeSection !== null && explorerSections.includes(activeSection) ? "block" : "none",
  };

  return (
    <>
      {/* Sidebar body: exactly one section, full height */}
      <Panel
        defaultSize={defaultWidth}
        collapsible
        // TODOLATER: Remove if the skip is annoying.
        minSize={sidebarCollapsed ? 0 : 18}
        className={`${sidebarCollapsed ? "max-w-0" : ""}`}
        style={{ display: sidebarCollapsed ? "none" : "block" }}
      >
        <div className="flex flex-col h-full">
          <div className="flex-1 overflow-hidden bg-gray-100">
            <div
              // z-[1500]: above Plotly's modebar (1000), which otherwise paints
              // through the covered plots, and below the modals (2001+). The
              // full stack is documented in index.css.
              className={explorerExpanded ? "fixed inset-0 z-[1500] bg-gray-100" : "h-full"}
              style={explorerStyle}
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
              />
            </div>

            <div className="h-full" style={sectionStyle("metadata")}>
              <Metadata basketItems={basketItems} />
            </div>

            <div className="h-full" style={sectionStyle("notes")}>
              <Notes
                basketItems={basketItems}
                isCollapsed={activeSection !== "notes"}
                selectedItemId={notesSelectedItemId}
                onSelectedItemChange={onNotesSelectedItemChange}
              />
            </div>
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
