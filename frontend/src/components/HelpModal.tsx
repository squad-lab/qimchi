import { useState, useEffect, useRef, memo, useMemo } from "react";
import {
  X,
  Search,
  FolderTree,
  ShoppingBasket,
  ListMusic,
  ChartScatter,
  NotebookPen,
  Keyboard,
  Lightbulb,
  Variable,
  SquareFunction,
  ChevronRight,
  BadgeInfo,
  Database,
  FileArchive,
  FileText,
  HardDrive,
  Table,
  Monitor,
  FolderOpen,
  Download,
  Heart,
  Trash2,
  Tag as TagIcon,
} from "lucide-react";
import { Rnd } from "react-rnd";
import Tooltip from "./Tooltip";
import { buildHelpIndex, searchHelp, HelpEntry, HelpSearchResult } from "./helpSearch";

// Section Definitions
interface HelpSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

// Helper for z-index management
const getNextGlobalModalZ = (): number => {
  if (typeof window === "undefined") return 2000;
  const w = window as unknown as { __qimchi_modal_z?: number };
  if (!w.__qimchi_modal_z) w.__qimchi_modal_z = 2000;
  w.__qimchi_modal_z = (w.__qimchi_modal_z || 2000) + 1;
  return w.__qimchi_modal_z;
};

// Content
const ExplorerHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <FolderTree size={20} className="text-blue-600" />
        Explorer
      </h3>
      <p className="text-gray-600 mb-4">
        Browse and navigate your file system to find datasets. Built-in formats and measurement
        sources include:
      </p>

      <div className="space-y-2 mb-4">
        <h4 className="font-medium text-gray-800">Sidebar layout</h4>
        <ul className="space-y-1.5 text-gray-600">
          <li className="flex gap-2">
            <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
            The narrow icon rail on the far left switches between Explorer, Metadata, Notes and Live
            -- one is shown at a time, filling the sidebar. Alt+1 to Alt+4 open them directly
          </li>
          <li className="flex gap-2">
            <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
            Clicking the section that is already open leaves it open. Use the button at the bottom
            of the rail (or Shift+E) to collapse and re-open the whole sidebar
          </li>
          <li className="flex gap-2">
            <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
            The expand button next to the folder button (or Shift+F) opens the Explorer across the
            whole window. Esc, Shift+F, or the same button returns it to the sidebar
          </li>
          <li className="flex gap-2">
            <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
            Rows show a modified-date column whenever the Explorer is wide enough -- either expanded
            or with the sidebar dragged wider
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="flex items-center gap-2 p-2 bg-violet-50/50 rounded-lg border border-violet-100">
          <FileArchive size={16} className="text-violet-600" />
          <span className="text-xs font-semibold">Zarr</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-sky-50/50 rounded-lg border border-sky-100">
          <FileText size={16} className="text-sky-600" />
          <span className="text-xs font-semibold">NetCDF</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-indigo-50/50 rounded-lg border border-indigo-100">
          <HardDrive size={16} className="text-indigo-600" />
          <span className="text-xs font-semibold">HDF5</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-teal-50/50 rounded-lg border border-teal-100">
          <Database size={16} className="text-teal-600" />
          <span className="text-xs font-semibold">QCoDeS</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-cyan-50/50 rounded-lg border border-cyan-100">
          <HardDrive size={16} className="text-cyan-600" />
          <span className="text-xs font-semibold">Quantify</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-emerald-50/50 rounded-lg border border-emerald-100">
          <Database size={16} className="text-emerald-600" />
          <span className="text-xs font-semibold">SQLite</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-orange-50/50 rounded-lg border border-orange-100">
          <Table size={16} className="text-orange-600" />
          <span className="text-xs font-semibold">CSV / TXT / DAT</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-fuchsia-50/50 rounded-lg border border-fuchsia-100">
          <FileArchive size={16} className="text-fuchsia-600" />
          <span className="text-xs font-semibold">xarray DataTree</span>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Quantify runs are recognized inside their HDF5 datasets and can also be streamed live with
        qimchi-connect. DataTree nodes can be browsed inside Zarr, NetCDF, and HDF5 containers.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Navigation</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Double-click a folder to navigate into it
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Double-click an SQLite container to browse its datasets
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Type in the path bar to navigate directly to any location
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use Ctrl/Shift+Click for multi-selection
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-2">
        <Heart size={15} className="text-red-500" />
        Hearts, Trash &amp; Tags
      </h4>
      <p className="text-gray-600">
        Mark measurements so you can find them again. These are saved to your Qimchi library and
        follow a measurement even if you rename or move its file.
      </p>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <Heart size={14} className="shrink-0 mt-0.5 text-red-500" />
          Heart a measurement from its row in the tree
        </li>
        <li className="flex gap-2">
          <Trash2 size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Trash hides it from view without touching the file on disk
        </li>
        <li className="flex gap-2">
          <TagIcon size={14} className="shrink-0 mt-0.5 text-indigo-500" />
          Tags are your own labels &mdash; a measurement can carry several
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Select several with Ctrl/Shift+Click, then use the heart, trash or tag buttons in the
          toolbar to apply to all of them at once
        </li>
      </ul>

      <h4 className="font-medium text-gray-800 pt-2">Filtering</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            Open the funnel icon in the toolbar for the filter row:{" "}
            <span className="font-semibold">Hearted</span>,{" "}
            <span className="font-semibold">Hide Trash</span> and{" "}
            <span className="font-semibold">Tags</span>
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            The <span className="font-semibold">Tags</span> dropdown is searchable; picking several
            matches measurements carrying <span className="italic">any</span> of them
          </span>
        </li>
      </ul>

      <h4 className="font-medium text-gray-800 pt-2">Searching by tag</h4>
      <p className="text-gray-600">
        You can also filter by tag straight from the search box, combined with an ordinary name
        search:
      </p>
      <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5 font-mono text-xs text-gray-700">
        <div>
          <span className="text-indigo-600">#cooldown</span>
          <span className="ml-2 font-sans text-gray-500">
            &mdash; measurements tagged &ldquo;cooldown&rdquo;
          </span>
        </div>
        <div>
          <span className="text-indigo-600">#&quot;Custom tag&quot;</span>
          <span className="ml-2 font-sans text-gray-500">
            &mdash; quote tag names containing spaces
          </span>
        </div>
        <div>
          <span className="text-indigo-600">#cooldown</span> sweep
          <span className="ml-2 font-sans text-gray-500">
            &mdash; tagged AND named &ldquo;sweep&rdquo;
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        A tag name that doesn&apos;t exist matches nothing, so check the spelling if results
        disappear. Tags typed here combine with any picked in the Tags dropdown.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Adding to Basket</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag individual datasets to the Basket
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag a folder to add all its dataset children to the Basket
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Double-click a dataset to toggle it in/out of the Basket
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            Use the <span className="font-mono bg-gray-100 px-1 rounded">+</span> button in item
            context menus
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Sorting & Filtering</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Sort by Name, Date, Size, or Chrono (newest-first flat list)
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Filter by All, Dataset only, or Folder only
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use the search bar to filter by name or path
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Dataset Cycling</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          When exactly one dataset is in the Basket, use the ↑/↓ arrow buttons to cycle through
          datasets in the current view
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Existing plots automatically update to the new dataset
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Live Measurements</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Pick the Live tab (Radio icon) in the sidebar rail to see only active live measurements,
          auto-refreshed every second. It is the Explorer in live mode, so the Explorer tab switches
          straight back to browsing files
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            Use <strong>Hide from Live Measurements</strong> to ignore an unwanted ongoing run. This
            only changes your local view; it does not stop the measurement or mark it finished.
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          New live measurements are automatically added to the Basket
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Drag to Notes</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag datasets from Explorer directly to the Notes panel to insert their paths into the
          current note
        </li>
      </ul>
    </div>
  </div>
));

const BasketHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <ShoppingBasket size={20} className="text-green-600" />
        Basket
      </h3>
      <p className="text-gray-600 mb-3">
        The Basket holds the datasets you're currently working with. Select dataset cards to define
        the plotting scope for the Composer.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Dataset Cards</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Click a card to select it as the active plotting dataset
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Ctrl/Cmd+Click to multi-select datasets for composite plots
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag datasets directly into the Basket drop zone to add them
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Field Chips</h4>
      <p className="text-gray-600 mb-2">
        Each dataset card shows its variable chips after attributes are loaded:
      </p>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1.5 bg-blue-100 px-2 py-1 rounded text-blue-900 text-xs">
          <Variable size={12} /> Independent
        </div>
        <div className="flex items-center gap-1.5 bg-red-100 px-2 py-1 rounded text-red-900 text-xs">
          <SquareFunction size={12} /> Dependent
        </div>
      </div>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag chips to Composer drop zones (X, Y, Z axes)
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Double-click a chip to auto-fill the next empty Composer axis
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Gray chips are not shared across selected datasets and cannot be added to the Composer
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Basket Actions</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Click the Basket ribbon outside its action buttons to collapse or expand the pane
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use the Trash icon to clear all datasets from the Basket
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use the Download icon to download all Basket datasets as a ZIP
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Per-item: copy filename, download, open notes, or remove
        </li>
      </ul>
    </div>
  </div>
));

const MetadataHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <BadgeInfo size={20} className="text-blue-500" />
        Metadata
      </h3>
      <p className="text-gray-600 mb-3">
        View and search detailed technical parameters for any dataset in your Basket. Metadata is
        automatically fetched from the backend when a file is added.
      </p>

      <div className="space-y-3">
        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Automatic Loading
          </h4>
          <p className="text-xs leading-relaxed">
            Metadata cards appear automatically for file items in your basket. A blue progress bar
            tracks loading status for multiple concurrent requests.
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Global Search
          </h4>
          <p className="text-xs leading-relaxed">
            Use the search bar to find specific values across all loaded metadata. Results highlight
            the exact key-value match and the navigation path (e.g., Sweeps → ...).
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Interactive JSON View
          </h4>
          <p className="text-xs leading-relaxed">
            Deeply nested parameters are displayed in an interactive tree. You can expand/collapse
            sections and copy values directly to your clipboard.
          </p>
        </div>

        <div className="p-3 rounded-lg border shadow-sm text-amber-800 bg-amber-50/50 border-amber-100">
          <h4 className="font-semibold mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Performance Note
          </h4>
          <p className="text-xs leading-relaxed">
            When searching, cards are automatically minimized to keep the view clean and responsive.
            Use the toggle buttons to peek into specific re-collapsed results.
          </p>
        </div>
      </div>
    </div>
  </div>
));

const ComposerHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <ListMusic size={20} className="text-purple-600" />
        Plot Composer
      </h3>
      <p className="text-gray-600 mb-3">
        The Composer maps dataset variables to plot axes to generate LinePlots or HeatMaps.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Plot Types</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>LinePlot:</strong> X (any field, max 1) + Y (dependents, multiple OK)
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>HeatMap:</strong> X (any, max 1) + Y (any, multiple) + Z (dependents, multiple)
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Adding Fields</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag chips from Basket cards into the X, Y, or Z drop zones
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Double-click chips to auto-fill axes sequentially (X → Y → Z)
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Invalid drops show a red border and an error message
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Multi-Dataset Plotting</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Multi-select dataset cards in the Basket to plot them all at once
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Only datasets that share the required variables will be plotted
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Incompatible datasets are skipped with a warning notification
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Clearing</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Click the Composer ribbon outside its action buttons to collapse or expand the pane
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use the X button on individual fields to remove them
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Click "Clear" on a drop zone to remove all fields from that axis
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use Alt+Shift+C to clear all Composer fields
        </li>
      </ul>
    </div>
  </div>
));

const ViewerHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <ChartScatter size={20} className="text-orange-600" />
        Viewer
      </h3>
      <p className="text-gray-600 mb-3">
        The Viewer displays your plots. Each plot is interactive and has its own controls for
        filtering, appearance, and export.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Plot Controls</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Click a plot to select it (highlighted border); use 1–9 keys to select by index
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Filters (F):</strong> Apply signal processing (diff, smoothing, BG corr…)
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Appearance (A):</strong> Colorscale, axis labels, range, title
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Maximize (M):</strong> Expand a plot to full panel view
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Swap Axes (S):</strong> Transpose X and Y axes on HeatMaps
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>BG Corr (B):</strong> Toggle background correction overlay
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>LineCut (Shift+X):</strong> Interactive line cut on HeatMaps
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Reset (R):</strong> Restore the original data, axes, filters, appearance, and zoom
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Send to Notes (N):</strong> Export current plot image to Notes
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <strong>Export Images (E):</strong> Download plot as PNG/SVG
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Paint Mode</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Hold Shift and click a plot&apos;s Filters or Appearance button to choose it as the Paint
          source
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          In Paint mode, Shift+Click other plots to apply copied settings
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Incompatible plot types (e.g., HeatMap → LinePlot) show an error
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Layout Controls</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Pin a plot to keep it on its current measurement while Next/Prev updates the other plots
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Use the 33 / 50 / 66 / 100 buttons to set plot width for all plots
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          50% forces side-by-side display of two plots
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Squarify button enforces a 1:1 aspect ratio on all plots
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          "Clear All Plots" removes all plots; Alt+Shift+V shortcut also works
        </li>
      </ul>
    </div>
  </div>
));

const NotesHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <NotebookPen size={20} className="text-violet-600" />
        Notes
      </h3>
      <p className="text-gray-600 mb-3">
        A markdown-based note-taking panel linked to your datasets. Notes are stored in
        Qimchi&apos;s local library so every supported dataset type, including QCoDeS runs, can have
        notes.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Working with Notes</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Open a note for a dataset via the NotebookPen icon in the Basket or Explorer
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Drag dataset paths from the Explorer directly into the Notes panel to insert them as links
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Send plot images from the Viewer to Notes via the "Send to Notes" (N) button
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Changes auto-save after two seconds; Ctrl/Cmd+S saves immediately
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Choose Pooled sample notes to keep a shared rolling note for all measurements in a sample
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Existing Markdown sidecars are imported automatically; when sidecar mirroring is enabled,
          Qimchi also writes an updated .md copy with YAML frontmatter
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Formatting</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Notes support standard Markdown: headers, bold, italic, lists, code blocks, tables
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Images sent from the Viewer are saved in a subfolder and linked in the note
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Toggle between Edit and Preview modes using the tab switcher
        </li>
      </ul>
    </div>
  </div>
));

const DesktopHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <Monitor size={20} className="text-cyan-600" />
        Desktop App
      </h3>
      <p className="text-gray-600 mb-3">
        The Qimchi desktop app is a single self-contained executable — it runs a local server inside
        a native window, with no separate Python/Node install. The features below are unique to it
        and don't apply when Qimchi is opened in a normal web browser.
      </p>
      <div className="p-3 rounded-lg border shadow-sm text-amber-800 bg-amber-50/50 border-amber-100">
        <h4 className="font-semibold mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          Alpha
        </h4>
        <p className="text-xs leading-relaxed">
          The desktop build is an early/alpha release. If something looks off, the debug log (see
          below) is the first place to check.
        </p>
      </div>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <FolderOpen size={15} className="text-[#6ea030]" />
        Open folder (native dialog)
      </h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            Click the green <span className="font-mono bg-gray-100 px-1 rounded">Load folder</span>{" "}
            button in the Explorer to open your operating system's folder picker and browse to a
            data directory
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          You can still type a path into the bar and press Enter, as in the browser version
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <Download size={15} className="text-blue-500" />
        Image export saves to Downloads
      </h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            Exporting plot images (<span className="font-mono bg-gray-100 px-1 rounded">E</span>)
            saves a ZIP straight to your{" "}
            <span className="font-mono bg-gray-100 px-1 rounded">Downloads</span> folder — the
            success toast shows the exact path
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          The individual PNG/SVG files are also written next to the dataset
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          On the first export, a one-time copy of Chrome may be downloaded if no system
          Chrome/Chromium is found — it's required by the image renderer
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Persistent settings</h4>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          Your Basket, plots, and panel layout persist across restarts
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <HardDrive size={15} className="text-indigo-600" />
        App data — <span className="font-mono bg-gray-100 px-1 rounded">~/.qimchi</span>
      </h4>
      <p className="text-gray-600 mb-1 text-xs">
        Everything the desktop app stores lives under{" "}
        <span className="font-mono bg-gray-100 px-1 rounded">~/.qimchi</span> (i.e.{" "}
        <span className="font-mono bg-gray-100 px-1 rounded">%USERPROFILE%\.qimchi</span> on
        Windows):
      </p>
      <ul className="space-y-1.5 text-gray-600">
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            <span className="font-mono bg-gray-100 px-1 rounded">webview/</span> — saved settings
            &amp; layout
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            <span className="font-mono bg-gray-100 px-1 rounded">logs/</span> — backend and desktop
            startup/runtime logs for troubleshooting
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            <span className="font-mono bg-gray-100 px-1 rounded">qimchi.db</span> — library marks,
            tags, notes, and cached metadata
          </span>
        </li>
        <li className="flex gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5 text-blue-500" />
          <span>
            <span className="font-mono bg-gray-100 px-1 rounded">chrome/</span> — the downloaded
            browser used for image export
          </span>
        </li>
      </ul>
    </div>
  </div>
));

const KeyboardHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <Keyboard size={20} className="text-gray-700" />
        Keyboard Shortcuts
      </h3>
      <p className="text-gray-600 mb-3">
        All shortcuts are global unless noted. Esc closes any open modal or mode.
      </p>
    </div>

    {/* Global */}
    <div>
      <h4 className="font-medium text-gray-800 mb-2">Global</h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {[
          ["H", "Set Composer to HeatMap"],
          ["Shift+H", "Toggle Help & Tips"],
          ["L", "Set Composer to LinePlot"],
          ["P", "Create Plot from Composer"],
          ["Shift+F", "Expand/exit full-window Explorer"],
          ["Alt+B", "Collapse/expand Basket"],
          ["Alt+C", "Collapse/expand Composer"],
          ["Alt+Shift+C", "Clear Composer"],
          ["Alt+Shift+B", "Clear Basket"],
          ["Alt+Shift+V", "Clear Viewer (all plots)"],
          ["Alt+Shift+H", "Heart selected datasets (Explorer)"],
          ["Alt+Shift+T", "Trash selected datasets (Explorer)"],
          ["Alt+1", "Open Explorer pane"],
          ["Alt+2", "Open Metadata pane"],
          ["Alt+3", "Open Notes pane"],
          ["Alt+4", "Open Live Measurements pane"],
          ["Shift+E", "Toggle Side Panel"],
          ["Shift+M", "Toggle Metadata Panel"],
          ["Shift+N", "Toggle Notes Panel"],
          ["Shift+R", "Refresh Directory"],
          ["Esc", "Close modals / exit modes"],
        ].map(([key, desc]) => (
          <div key={key} className="contents">
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 text-xs self-start">
              {key}
            </span>
            <span className="text-gray-600 text-xs self-center">{desc}</span>
          </div>
        ))}
      </div>
    </div>

    {/* Selected Plot */}
    <div>
      <h4 className="font-medium text-gray-800 mb-2">
        Selected Plot{" "}
        <span className="font-normal text-gray-500 text-xs">(requires a plot to be selected)</span>
      </h4>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {[
          ["1–9", "Select plot by index"],
          ["F", "Open Filters modal"],
          ["A", "Open Appearance modal"],
          ["M", "Maximize / restore plot"],
          ["B", "Toggle BG Correction"],
          ["S", "Swap X/Y axes"],
          ["Shift+X", "Enter LineCut mode (HeatMap)"],
          ["R", "Reset plot data, filters, appearance and zoom"],
          ["N", "Send plot to Notes"],
          ["E", "Export plot images"],
          ["Del", "Remove selected plot"],
        ].map(([key, desc]) => (
          <div key={key} className="contents">
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 text-xs self-start">
              {key}
            </span>
            <span className="text-gray-600 text-xs self-center">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
));

// Sections Array
const HELP_SECTIONS: HelpSection[] = [
  {
    id: "explorer",
    label: "Explorer",
    icon: <FolderTree size={16} />,
    content: <ExplorerHelp />,
  },
  {
    id: "basket",
    label: "Basket",
    icon: <ShoppingBasket size={18} />,
    content: <BasketHelp />,
  },
  {
    id: "metadata",
    label: "Metadata",
    icon: <BadgeInfo size={18} />,
    content: <MetadataHelp />,
  },
  {
    id: "composer",
    label: "Composer",
    icon: <ListMusic size={16} />,
    content: <ComposerHelp />,
  },
  {
    id: "viewer",
    label: "Viewer",
    icon: <ChartScatter size={16} />,
    content: <ViewerHelp />,
  },
  {
    id: "notes",
    label: "Notes",
    icon: <NotebookPen size={16} />,
    content: <NotesHelp />,
  },
  {
    id: "desktop",
    label: "Desktop App",
    icon: <Monitor size={16} />,
    content: <DesktopHelp />,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: <Keyboard size={16} />,
    content: <KeyboardHelp />,
  },
];

// Modal Component
interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: open directly to this section id */
  initialSection?: string;
}

// Render an entry's text with the matched characters marked.
const HighlightedText = ({ text, positions }: { text: string; positions: number[] }) => {
  if (positions.length === 0) return <>{text}</>;

  const hit = new Set(positions);
  const pieces: React.ReactNode[] = [];
  let buffer = "";
  let bufferMatched = hit.has(0);

  const flush = (key: number) => {
    if (!buffer) return;
    pieces.push(
      bufferMatched ? (
        <mark key={key} className="rounded bg-amber-200 px-0.5 text-gray-900">
          {buffer}
        </mark>
      ) : (
        <span key={key}>{buffer}</span>
      ),
    );
    buffer = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const matched = hit.has(i);
    if (matched !== bufferMatched) {
      flush(i);
      bufferMatched = matched;
    }
    buffer += text[i];
  }
  flush(text.length);

  return <>{pieces}</>;
};

const HelpModal = ({ isOpen, onClose, initialSection }: HelpModalProps) => {
  const [activeSection, setActiveSection] = useState(initialSection ?? HELP_SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);

  const zRef = useRef<number | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Built on the first search rather than at mount: walking every section costs
  // nothing noticeable, but there is no reason to pay it for users who never
  // search.
  const indexRef = useRef<HelpEntry[] | null>(null);
  const pendingScrollRef = useRef<string | null>(null);

  const results = useMemo<HelpSearchResult[]>(() => {
    if (!query.trim()) return [];
    if (!indexRef.current) indexRef.current = buildHelpIndex(HELP_SECTIONS);
    return searchHelp(indexRef.current, query);
  }, [query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      const next = getNextGlobalModalZ();
      zRef.current = next;
      if (wrapperRef.current) {
        wrapperRef.current.style.zIndex = String(next);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isOpen) return;
      // Escape backs out of a search first; a second press closes the modal.
      if (query) {
        setQuery("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [isOpen, onClose, query]);

  const bringToFront = () => {
    const next = getNextGlobalModalZ();
    zRef.current = next;
    if (wrapperRef.current) {
      wrapperRef.current.style.zIndex = String(next);
    }
  };

  // Sync when initialSection changes (e.g., opened from a specific button)
  const activeContent = useMemo(() => {
    return HELP_SECTIONS.find((s) => s.id === activeSection)?.content;
  }, [activeSection]);

  // After jumping to a section, find the block whose text matches the chosen
  // result and flash it. Matching on text keeps the static help JSX free of
  // ids that would have to be kept in step with the index.
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (!target || !contentRef.current) return;
    pendingScrollRef.current = null;

    const nodes = contentRef.current.querySelectorAll("p, li, td, th, h3, h4, h5");
    for (const node of nodes) {
      if ((node.textContent || "").replace(/\s+/g, " ").trim() === target) {
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        node.classList.add("qimchi-help-hit");
        window.setTimeout(() => node.classList.remove("qimchi-help-hit"), 1600);
        break;
      }
    }
  }, [activeSection, activeContent]);

  const openResult = (result: HelpSearchResult) => {
    pendingScrollRef.current = result.entry.text;
    setActiveSection(result.entry.sectionId);
    setQuery("");
    searchInputRef.current?.blur();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openResult(results[highlightIndex]);
    }
  };

  if (!isOpen) return null;

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
          className="bg-white rounded-xl shadow-2xl border border-gray-300 flex flex-col overflow-hidden w-full h-full"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-amber-200 border-b border-amber-300 drag-handle cursor-move shrink-0">
            <div className="flex items-center gap-2">
              <div className="bg-amber-100 p-1.5 rounded-lg border border-amber-200 shadow-sm">
                <Lightbulb size={18} className="text-amber-600 fill-amber-500/10" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-800 tracking-tight">Help &amp; Tips</h2>
                <span className="text-[12px] font-mono font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-300/50 opacity-90">
                  Shift+H
                </span>
              </div>
            </div>
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

          {/* Search: spans both panes, directly under the header */}
          <div className="shrink-0 border-b border-gray-200 bg-gray-50 p-2">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search help..."
                aria-label="Search help"
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Body: left tabs + right content */}
          <div className="flex flex-1 min-h-0 bg-white">
            {/* Left: section list */}
            <div className="w-44 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
              {HELP_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3.5 text-sm font-semibold transition-all border-b border-gray-100 ${
                    activeSection === section.id
                      ? "bg-amber-50 text-amber-700 border-l-4 border-l-amber-500 shadow-inner"
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 border-l-4 border-l-transparent"
                  }`}
                >
                  <span
                    className={activeSection === section.id ? "text-amber-600" : "text-gray-400"}
                  >
                    {section.icon}
                  </span>
                  {section.label}
                </button>
              ))}
            </div>

            {/* Right: search + content pane */}
            <div className="flex min-w-0 flex-1 flex-col bg-white">
              <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
                {query.trim() ? (
                  results.length === 0 ? (
                    <div className="pt-8 text-center text-sm text-gray-500">
                      No help matches &ldquo;{query}&rdquo;
                    </div>
                  ) : (
                    <div className="space-y-1" role="group" aria-label="Help search results">
                      <p className="mb-2 text-xs text-gray-500">
                        {results.length} result{results.length === 1 ? "" : "s"} -- Enter to open,
                        arrows to move
                      </p>
                      {results.map((result, index) => (
                        <button
                          key={result.entry.id}
                          onClick={() => openResult(result)}
                          onMouseEnter={() => setHighlightIndex(index)}
                          className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                            index === highlightIndex
                              ? "border-amber-300 bg-amber-50"
                              : "border-transparent hover:bg-gray-50"
                          }`}
                        >
                          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-gray-500">
                            <span>{result.entry.sectionLabel}</span>
                            {result.entry.heading && result.entry.heading !== result.entry.text && (
                              <>
                                <ChevronRight size={11} />
                                <span className="truncate">{result.entry.heading}</span>
                              </>
                            )}
                          </div>
                          <div
                            className={`text-sm text-gray-800 ${
                              result.entry.isHeading ? "font-semibold" : ""
                            }`}
                          >
                            <HighlightedText
                              text={result.entry.text}
                              positions={result.positions}
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="max-w-prose">{activeContent}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Rnd>
    </div>
  );
};

export default HelpModal;
