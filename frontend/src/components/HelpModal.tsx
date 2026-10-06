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
  Settings as SettingsIcon,
  Grid3x3,
  Compass,
  AlertTriangle,
} from "lucide-react";
import SectionedModal from "./SectionedModal";
import { OBLIQUE_CUT_CAVEAT } from "../utils/lineCut";
import { buildHelpIndex, searchHelp, HelpEntry, HelpSearchResult } from "./helpSearch";

// Help sections
interface HelpSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

// Section content
const ExplorerHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <FolderTree size={20} className="text-blue-600" />
        Explorer
      </h3>

      <div className="mb-4 p-3 rounded-lg border shadow-sm text-amber-800 bg-amber-50/50 border-amber-100">
        <h4 className="font-semibold mb-1 flex items-center gap-1.5">
          <Compass size={14} className="shrink-0" />
          New to Qimchi?
        </h4>
        <p className="text-xs leading-relaxed">
          Take the walkthrough, from the button at the top of this window or the compass just below
          Help on the rail. It is a short guided tour.
        </p>
      </div>

      <div className="space-y-2 mb-4">
        <h4 className="font-medium text-gray-800">Sidebar Layout</h4>
        <ul className="space-y-2 text-gray-600">
          <li className="flex gap-2 leading-relaxed">
            <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
            <span>
              Use the icon rail on the far left to switch between Explorer, Metadata, Notes and
              Live. Alt+1 through Alt+4 open these sections directly
            </span>
          </li>
          <li className="flex gap-2 leading-relaxed">
            <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
            <span>
              Use the button at the bottom of the rail, or Shift+E, to collapse or reopen the
              sidebar
            </span>
          </li>
          <li className="flex gap-2 leading-relaxed">
            <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
            <span>
              Use the expand button beside the folder button, or Shift+F, to open Explorer across
              the window. Press Esc or Shift+F to return it to the sidebar
            </span>
          </li>
          <li className="flex gap-2 leading-relaxed">
            <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
            <span>
              The modified date appears when Explorer is wide enough, either in expanded view or
              after you widen the sidebar
            </span>
          </li>
        </ul>
      </div>

      <p className="text-gray-600 mb-4">
        Browse your file system and open datasets from these formats and measurement sources:
      </p>

      <div className="grid grid-cols-1 @min-[460px]/panel:grid-cols-2 @min-[860px]/panel:grid-cols-3 gap-2 mb-4">
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
        <div className="flex items-center gap-2 p-2 bg-rose-50/50 rounded-lg border border-rose-100">
          <Grid3x3 size={16} className="text-rose-600" />
          <span className="text-xs font-semibold">MATLAB (.mat)</span>
        </div>
        <div className="flex items-center gap-2 p-2 bg-fuchsia-50/50 rounded-lg border border-fuchsia-100">
          <FileArchive size={16} className="text-fuchsia-600" />
          <span className="text-xs font-semibold">xarray DataTree</span>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Qimchi recognises Quantify runs inside HDF5 datasets. They can also be streamed live with
        qimchi-connect. DataTree nodes can be browsed inside Zarr, NetCDF, and HDF5 containers.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Navigation</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Double-click a folder to navigate into it</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Double-click an SQLite container to browse its datasets</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Type in the path bar to navigate directly to any location</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use Ctrl+Click or Shift+Click to select multiple items</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-2">
        <Heart size={15} className="text-red-500" />
        Hearts, Trash &amp; Tags
      </h4>
      <p className="text-gray-600">
        Mark measurements so they are easy to find later. Hearts, trash status and tags are stored
        in your Qimchi library and stay with a measurement if its file is renamed or moved.
      </p>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <Heart size={14} className="shrink-0 mt-1 text-red-500" />
          <span>Use the heart on a row to mark a measurement as a favourite</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <Trash2 size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Trash hides a measurement without deleting its file</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <TagIcon size={14} className="shrink-0 mt-1 text-indigo-500" />
          <span>Add one or more tags to organise a measurement</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Select several measurements with Ctrl+Click or Shift+Click, then apply a heart, trash or
            tag action from the toolbar
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Folders can be hearted, trashed and tagged too, and everything inside a folder counts as
            marked when you filter. Unlike a measurement, a folder loses its marks if you rename or
            move it
          </span>
        </li>
      </ul>

      <h4 className="font-medium text-gray-800 pt-2">Filtering</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              Select the funnel in the toolbar to show filters for{" "}
              <span className="font-semibold">Hearted</span>,{" "}
              <span className="font-semibold">Trashed</span> and{" "}
              <span className="font-semibold">Tagged</span>
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Trashed shows only measurements that have been moved to trash</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              Search the <span className="font-semibold">Tagged</span> dropdown or select several
              tags. A measurement matches if it has <span className="italic">any</span> selected tag
            </span>
          </span>
        </li>
      </ul>

      <h4 className="font-medium text-gray-800 pt-2">Searching by Tag</h4>
      <p className="text-gray-600">
        You can combine tag filters with a name search in the search box:
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
        An unknown tag returns no results. Tags entered here are combined with selections from the
        Tagged dropdown.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Adding to Basket</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Drag individual datasets to the Basket</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Drag a folder to add all its dataset children to the Basket</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Double-click a dataset to add it to or remove it from the Basket</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Select several files, then use Add in the Explorer toolbar</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Sorting & Filtering</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Choose Name, Date, Size or Chrono from the Sort menu. The second Sort button changes the
            direction; Chrono is always newest first
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use the search bar to filter by name or path</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Dataset Cycling</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            When exactly one dataset is in the Basket, use the ↑/↓ arrow buttons to cycle through
            datasets in the current view
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Existing plots automatically update to the new dataset</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Live Measurements</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Select Live in the sidebar rail to show active measurements. Select Explorer to return
            to your files
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Select <strong>Hide from Live Measurements</strong> to remove an active run from this
            list. This does not stop the measurement or mark it as finished.
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            New live measurements are added to the Basket automatically. You can turn this off under
            Settings &gt; Live
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            A live plot adjusts its refresh rate to the workload, from once every 300 ms to once
            every 5 seconds. You can change the fastest rate under Settings &gt; Live
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Show only live and pinned plots</strong>, on the Viewer&apos;s ribbon, hides
            every other plot without removing it. Select it again to show them all
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Refresh statistics are written to the local app log every few minutes. Search for
            &quot;live refresh&quot; to view them
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Drag to Notes</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Drag datasets from Explorer directly to the Notes panel to insert their paths into the
            current note
          </span>
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
        The Basket holds the datasets in your current workspace. Select one or more cards to choose
        which datasets the Composer will plot. The Basket can hold up to 50 datasets.
      </p>
      <p className="text-gray-600 mb-3">
        When the Viewer is empty, adding a dataset creates the default plots selected under Settings
        &gt; Plots. If plots are already open, Qimchi recreates compatible plots and their filters
        for the new measurement. It uses the defaults only when none of the open plots are
        compatible.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Dataset Cards</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Click a card to select it as the active plotting dataset</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use Ctrl/Cmd+Click to select multiple datasets for composite plots</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Drag datasets directly into the Basket drop zone to add them</span>
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
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Drag chips to Composer drop zones (X, Y, Z axes)</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Double-click a chip to auto-fill the next empty Composer axis</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Gray chips are not shared across selected datasets and cannot be added to the Composer
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Basket Actions</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Click the Basket ribbon outside its action buttons to collapse or expand the pane
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use the Trash icon to clear all datasets from the Basket</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use the Download icon to download all Basket datasets as a ZIP</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Use a dataset&apos;s menu to copy its filename, download it, open its notes or remove it
          </span>
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
        View and search metadata for datasets in your Basket. Qimchi loads the metadata when you add
        a dataset.
      </p>

      <div className="space-y-3">
        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Loading
          </h4>
          <p className="text-xs leading-relaxed">
            Each dataset has its own metadata card. A blue progress bar shows the combined loading
            progress when several datasets are being loaded.
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Search
          </h4>
          <p className="text-xs leading-relaxed">
            Search keys and values across all loaded metadata. Each result shows the match and its
            path, such as Sweeps → Gate voltage.
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            JSON Tree
          </h4>
          <p className="text-xs leading-relaxed">
            Expand or collapse nested sections and copy values to the clipboard.
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
          <h4 className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Pinned Parameters
          </h4>
          <p className="text-xs leading-relaxed">
            In a qanary Parameters Snapshot, hover over a parameter and click its pin. Pinned values
            appear in a movable window and update when you use Next or Prev. Unpin them there or in
            Metadata.
          </p>
        </div>

        <div className="p-3 rounded-lg border shadow-sm text-amber-800 bg-amber-50/50 border-amber-100">
          <h4 className="font-semibold mb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Search Results
          </h4>
          <p className="text-xs leading-relaxed">
            While searching, cards collapse to show matching entries. Expand a card to inspect its
            surrounding metadata.
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
        Assign dataset variables to axes, then create a LinePlot or HeatMap.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Plot Types</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>LinePlot:</strong> one X field and one or more dependent Y fields
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>HeatMap:</strong> one X field, one Y field and one or more dependent Z fields
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Measured Variables as Axes</h4>
      <p className="text-gray-600 mb-2">
        An axis can use a measured variable, such as plotting current against a measured gate
        voltage. The variables must share the same sweep dimension. After you choose an axis,
        incompatible fields are greyed out in the Basket.
      </p>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>LinePlot:</strong> plot any two variables from the same sweep. Points remain in
            measurement order, even when the sweep changes direction
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>HeatMap:</strong> one axis may be measured, but the other must be a swept
            coordinate. Two measured axes describe a path rather than a grid
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            A variable that changes across more than one sweep dimension cannot be used as a single
            axis
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Adding Fields</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Drag chips from Basket cards into the X, Y, or Z drop zones</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Double-click a chip to fill the next available axis (X → Y → Z)</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Invalid drops show a red border and an error message</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Multi-Dataset Plotting</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Multi-select dataset cards in the Basket to plot them all at once</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Qimchi plots only datasets that contain the required variables</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>A notification lists any incompatible datasets that were skipped</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Clearing</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Click the Composer ribbon outside its action buttons to collapse or expand the pane
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use the X button on individual fields to remove them</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Select Clear on a drop zone to remove every field from that axis</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use Alt+Shift+C to clear all Composer fields</span>
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
        View and interact with plots, apply filters, adjust their appearance and export results.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Reading a Plot</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Axis titles show units with an engineering prefix suited to the visible range, such as
            mV instead of 0.001 V
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Hover labels format each value separately with no more than two decimal places. Their
            prefixes may differ from the axis prefixes
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            When a filter changes a heat map&apos;s values, such as a derivative, its hover label
            shows the new quantity and unit, matching the colour bar
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Plot Controls</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Select a plot by clicking it or by pressing its number from 1 to 9</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Filters (F):</strong> Apply differentiation, smoothing, background correction
            and other processing. Filters that require an ordered sweep are unavailable when X
            contains measured data; hover over one to see why
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Filters run in the order you applied them, shown in the Filters panel&apos;s Applied
            section. Drag a filter there, or use its arrows, to change the order, and the plot is
            redrawn with the new order
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Saved Presets:</strong> Save a filter sequence and apply it to any plot. The
            Applied section shows changes to a linked preset and lets you update, revert, unlink, or
            save a copy. Saved Presets also supports rename, replace, and remove
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>
              R<sub>in</sub> Correction:
            </strong>{" "}
            On a heat map of measured current, replace the applied bias with the voltage across the
            sample, V<sub>S</sub> = V<sub>b</sub> − I × R<sub>in</sub>, by entering the resistance
            in line with the sample and choosing which axis holds the bias. Each line is redrawn
            against V<sub>S</sub>, so parts of the map where a line has no data are left empty
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Sliders:</strong> When a plotted variable varies over more dimensions than the
            plot shows, Filters has a slider for each of the others. Dimensions labelled with text
            step through their labels
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Complex variables provide amplitude, unwrapped phase in radians, real, and imaginary
            values
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Appearance (A):</strong> Change the colorscale, labels, ranges and title
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Maximize (M):</strong> Expand a plot to fill the Viewer
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Swap Axes (S):</strong> Exchange the X and Y axes of a HeatMap
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Background correction (B):</strong> Open it from Filters, or press B to toggle
            its interactive overlay
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>LineCut (Shift+X):</strong> Inspect a horizontal, vertical or oblique slice of a
            HeatMap. Press X, Y or O to choose. For an oblique cut, click where it starts and then
            where it ends. Right-click the heat map to lock the cut in place, and right-click again
            to let it follow the pointer. The preview opens in a pop-up beside the plot; expand it
            to the full window from its header
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            The preview&apos;s title names the axis and where the slice is, such as &quot;Slice at
            Voltage 1 = 421 mV&quot;, and its hover label uses the heat map&apos;s names and units.
            Hover labels stay above the LineCut guide. Choose the starting direction under Settings
            &gt; Plots
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <div>
            <strong>Markers:</strong> Add vertical lines, horizontal lines or points to the LineCut
            preview.
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                Choose a tool and click the preview. Hold Shift to place freely instead of snapping
                to data.
              </li>
              <li>
                Select a marker and use the arrow keys to move it. Shift moves 5 steps by default;
                change this under Settings &gt; Plots.
              </li>
              <li>Press Delete or use the marker list to remove it.</li>
              <li>
                Horizontal and vertical cuts keep separate markers until the plot closes. Oblique
                cuts have none.
              </li>
            </ul>
          </div>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            On a live heat map, Follow keeps the cut on the row or column currently being measured,
            including its partial values. It moves when the next line starts and changes orientation
            when the heat-map axes are swapped. Choosing a direction or right-clicking stops Follow
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <AlertTriangle size={14} className="shrink-0 mt-1 text-amber-500" />
          <span>{OBLIQUE_CUT_CAVEAT}</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Reset (R):</strong> Restore the original data, axes, filters and zoom, and
            return the appearance to your defaults from Settings
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Export → Notes (N):</strong> Add the current plot image to Notes
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Export → Disk (E):</strong> Save the plot as PNG/SVG
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Export → Copy:</strong> Copy the plot to the clipboard as a PNG, exactly as it
            is shown
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Width (↔):</strong> Set this plot&apos;s width to 33, 50, 66 or 100%
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Move (grip handle):</strong> Drag the plot to a new position, or focus the
            handle and use the arrow keys
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Paint Mode</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Hold Shift and select a plot&apos;s Filters or Appearance button to use that plot as the
            Paint source
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>In Paint mode, Shift+Click another plot to apply the copied settings</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Qimchi reports settings that cannot be applied to the target plot type</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Layout Controls</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Pin a plot to keep its current measurement while Next and Previous update the others
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Set the width of all plots to 33%, 50%, 66% or 100%, or use a plot&apos;s width button
            (↔) to change only that plot
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Drag a plot&apos;s grip handle to rearrange it, or focus the handle and use the arrow
            keys. Moving a plot does not change its width
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Set the width to 50% to place two plots side by side</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Squarify gives every plot a 1:1 aspect ratio</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Clear All Plots, or press Alt+Shift+V, to remove every plot</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Closed a plot by mistake? Press Ctrl+Z (Cmd+Z on a Mac), or Undo in the message that
            appears, to bring it back where it was, with its filters, settings and width. After
            Clear All Plots, one Ctrl+Z brings them all back. The Recently closed button in the
            Viewer&apos;s ribbon lists the last closed plots, 25 unless you change it under Settings
            &gt; Plots, so you can reopen any one of them
          </span>
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
        Write Markdown notes for any supported dataset, including QCoDeS runs. Notes are stored in
        Qimchi&apos;s local library.
      </p>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Working with Notes</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use the note icon in the Basket or Explorer to open a dataset&apos;s note</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Drag dataset paths from the Explorer directly into the Notes panel to insert them as
            links
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use Export → Notes on a plot, or press N, to add its image to the note</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Changes auto-save after two seconds; Ctrl/Cmd+S saves immediately</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Hover over the save-status icon to see when the note was last saved</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use the copy button beside the autosave status to copy the note path</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Choose Pooled sample notes to share one running note across all measurements in a sample
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Qimchi imports existing Markdown sidecars. If sidecar mirroring is enabled, it also
            writes an updated .md file with YAML front matter
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Formatting</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Use standard Markdown for headings, emphasis, lists, code blocks and tables</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Images sent from the Viewer are saved in a subfolder and linked in the note</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Switch between Edit and Preview with the tabs above the note</span>
        </li>
      </ul>
    </div>
  </div>
));

const SettingsHelp = memo(() => (
  <div className="space-y-4 text-sm text-gray-700">
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <SettingsIcon size={20} className="text-blue-600" />
        Settings
      </h3>
      <p className="text-gray-600 mb-3">
        Open Settings from the sidebar rail or press Shift+S. Changes take effect immediately and
        are saved across restarts.
      </p>
      <ul className="list-disc space-y-2 pl-5 leading-relaxed">
        <li>
          <strong>General</strong>: choose the theme, interface zoom and default plot width. The
          System theme follows your operating system
        </li>
        <li>
          <strong>Plots</strong>: choose which plots are created for a new measurement, whether
          custom plots are recreated, whether plots use a square aspect ratio and which direction
          LineCut starts in
        </li>
        <li>
          <strong>Explorer</strong>, <strong>Live</strong> and <strong>Export</strong>: set the sort
          order, automatic Basket additions and exported image formats
        </li>
        <li>
          <strong>Updates</strong> (desktop app): check for updates, include preview releases and
          control automatic checks. Downloads continue in the background, and the sidebar rail shows
          their status
        </li>
        <li>
          <strong>HeatMap</strong> and <strong>LinePlot</strong>: set the default appearance for
          each plot type. Per-plot Appearance settings override these defaults; Reset restores them
        </li>
        <li>
          <strong>Developer</strong>: add render times to exports, and save Qimchi&apos;s logs as
          one zip file to attach to a bug report, optionally with recent crash reports
        </li>
      </ul>
      <p className="mt-3 text-gray-600">
        Use the buttons in the Settings title bar to import or export a JSON settings file.
        Importing replaces all settings; missing values return to their defaults.
      </p>
      <p className="mt-3 text-gray-600">
        If the database is unavailable, Settings displays a warning and changes apply only to the
        current window.
      </p>
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
        The desktop app runs Qimchi and its local server in one native application. It does not
        require a separate Python or Node installation. The features below are not available in a
        regular web browser.
      </p>
      <div className="p-3 rounded-lg border shadow-sm text-amber-800 bg-amber-50/50 border-amber-100">
        <h4 className="font-semibold mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          Alpha
        </h4>
        <p className="text-xs leading-relaxed">
          The desktop build is an alpha release. If something goes wrong, check the logs described
          below.
        </p>
      </div>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <FolderOpen size={15} className="text-[#6ea030]" />
        Open a Folder
      </h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              Select <span className="font-mono bg-gray-100 px-1 rounded">Load folder</span> in
              Explorer, then choose a data directory from the system dialog
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>You can also enter a path directly and press Enter</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <Download size={15} className="text-blue-500" />
        Export Images
      </h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              Exporting plot images (<span className="font-mono bg-gray-100 px-1 rounded">E</span>)
              saves a ZIP to the export folder chosen in Settings &gt; Export, or to your{" "}
              <span className="font-mono bg-gray-100 px-1 rounded">Downloads</span> folder if none
              is set. The notification shows the full path
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Qimchi also writes the individual PNG and SVG files beside the dataset</span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            To export every plot at once, use the export button on the Viewer&apos;s ribbon. You get
            one ZIP with a ZIP for each plot inside, each exported with its own zoom and filters
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            If no compatible Chrome or Chromium installation is available, Qimchi downloads a
            private copy for image rendering on the first export
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Updates</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Qimchi checks for a new version when it starts and offers to download it in the
            background while you keep working. When the download finishes, it asks before
            installing; choose 'Remind me at next launch' to install later
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Windows:</strong> Qimchi closes and the usual installer opens. Follow its steps;
            its last page can start Qimchi again
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>macOS:</strong> Qimchi closes, puts the new version in place of the old one in
            Applications and opens it. If macOS asks, allow Qimchi under Privacy &amp; Security &gt;
            App Management; otherwise the disk image opens so you can drag Qimchi into Applications
            yourself
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <strong>Linux:</strong> Qimchi replaces its AppImage and restarts, or saves the new
            AppImage to your Downloads folder if it cannot
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Check for updates, or include preview releases, under Settings &gt; Updates</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <FileArchive size={15} className="text-blue-500" />
        Logs and Bug Reports
      </h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            Qimchi records what it does in two log files in{" "}
            <span className="font-mono bg-gray-100 px-1 rounded">~/.qimchi/logs</span>. Every line
            has the date and time, and once a minute Qimchi also notes how much memory it, its
            export helpers, Chrome and the app window are using
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            To report a problem, use the bug button on the sidebar rail. It explains what to
            include, links to a new GitLab issue, and creates a ZIP containing the logs and a system
            summary. Recent crash reports can be included as well
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            To watch the log as it is written, open the notification log from the sidebar rail and
            use its terminal button
          </span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800">Persistent Settings</h4>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>Your Basket, plots, and panel layout persist across restarts</span>
        </li>
      </ul>
    </div>

    <div className="space-y-2">
      <h4 className="font-medium text-gray-800 flex items-center gap-1.5">
        <HardDrive size={15} className="text-indigo-600" />
        App data — <span className="font-mono bg-gray-100 px-1 rounded">~/.qimchi</span>
      </h4>
      <p className="text-gray-600 mb-1 text-xs">
        The desktop app stores its data under{" "}
        <span className="font-mono bg-gray-100 px-1 rounded">~/.qimchi</span> ({" "}
        <span className="font-mono bg-gray-100 px-1 rounded">%USERPROFILE%\.qimchi</span> on
        Windows):
      </p>
      <ul className="space-y-2 text-gray-600">
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              <span className="font-mono bg-gray-100 px-1 rounded">webview/</span> — saved settings
              &amp; layout
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              <span className="font-mono bg-gray-100 px-1 rounded">logs/</span> — backend and
              desktop logs
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              <span className="font-mono bg-gray-100 px-1 rounded">qimchi.db</span> — library marks,
              tags, notes, and cached metadata
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span>
              <span className="font-mono bg-gray-100 px-1 rounded">chrome/</span> — the downloaded
              browser used for image export
            </span>
          </span>
        </li>
        <li className="flex gap-2 leading-relaxed">
          <ChevronRight size={14} className="shrink-0 mt-1 text-blue-500" />
          <span>
            <span className="font-mono bg-gray-100 px-1 rounded">updates/</span> — a downloaded
            update waiting to be installed, and the installer&apos;s log
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
        Shortcuts work throughout Qimchi unless noted. Esc closes the current modal or mode.
      </p>
    </div>

    {/* Global */}
    <div>
      <h4 className="font-medium text-gray-800 mb-2">Global</h4>
      <div className="grid grid-cols-1 @min-[460px]/panel:grid-cols-2 @min-[860px]/panel:grid-cols-4 gap-x-4 gap-y-1.5">
        {[
          ["H", "Set Composer to HeatMap"],
          ["Shift+H", "Toggle Help & Tips"],
          ["Shift+S", "Toggle Settings"],
          ["L", "Set Composer to LinePlot"],
          ["P", "Create Plot from Composer"],
          ["Shift+F", "Expand/exit full-window Explorer"],
          ["Alt+B", "Collapse/expand Basket"],
          ["Alt+C", "Collapse/expand Composer"],
          ["Alt+Shift+C", "Clear Composer"],
          ["Alt+Shift+B", "Clear Basket"],
          ["Alt+Shift+V", "Clear Viewer (all plots)"],
          ["Ctrl+Z", "Reopen the last closed plot(s)"],
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
          ["Ctrl/Cmd + / −", "Zoom in / out (desktop app)"],
          ["Esc", "Close modals / exit modes / leave the walkthrough"],
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
      <div className="grid grid-cols-1 @min-[460px]/panel:grid-cols-2 @min-[860px]/panel:grid-cols-4 gap-x-4 gap-y-1.5">
        {[
          ["1–9", "Select plot by index"],
          ["F", "Open Filters modal"],
          ["A", "Open Appearance modal"],
          ["M", "Maximize / restore plot"],
          ["B", "Toggle BG Correction"],
          ["S", "Swap X/Y axes"],
          ["Shift+X", "Enter LineCut mode (HeatMap)"],
          ["X / Y / O", "Cut horizontally, vertically or obliquely (in LineCut)"],
          ["Right-click", "Lock or unlock the cut (in LineCut)"],
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

// Section list
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
    id: "settings",
    label: "Settings",
    icon: <SettingsIcon size={16} />,
    content: <SettingsHelp />,
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

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Section to show when the modal opens. */
  initialSection?: string;
  onStartWalkthrough?: () => void;
  /** Whether this modal has paused an active walkthrough. */
  walkthroughActive?: boolean;
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

const HelpModal = ({
  isOpen,
  onClose,
  initialSection,
  onStartWalkthrough,
  walkthroughActive = false,
}: HelpModalProps) => {
  const [activeSection, setActiveSection] = useState(initialSection ?? HELP_SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Build the index only when search is used.
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

  // Escape backs out of a search first; a second press closes the modal.
  const handleEscape = () => (query ? setQuery("") : onClose());

  const activeContent = useMemo(() => {
    return HELP_SECTIONS.find((s) => s.id === activeSection)?.content;
  }, [activeSection]);

  // Find and briefly highlight the selected search result.
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
    <SectionedModal
      isOpen={isOpen}
      onClose={onClose}
      onEscape={handleEscape}
      title="Help & Tips"
      icon={<Lightbulb size={18} className="text-amber-600 fill-amber-500/10" />}
      shortcut="Shift+H"
      accent="amber"
      sections={HELP_SECTIONS}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      navLabel="Help sections"
      contentRef={contentRef}
      headerActions={
        onStartWalkthrough && (
          <button
            onClick={onStartWalkthrough}
            className="mr-2 flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm ring-1 ring-amber-700/40 transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:text-gray-900 dark:hover:bg-amber-400"
          >
            <Compass size={15} />
            {walkthroughActive ? "Back to the walkthrough" : "Take the walkthrough"}
          </button>
        )
      }
      toolbar={
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
      }
    >
      {query.trim() ? (
        results.length === 0 ? (
          <div className="pt-8 text-center text-sm text-gray-500">
            No results for &ldquo;{query}&rdquo;
          </div>
        ) : (
          <div className="space-y-1" role="group" aria-label="Help search results">
            <p className="mb-2 text-xs text-gray-500">
              {results.length} result{results.length === 1 ? "" : "s"} · Press Enter to open; use
              the arrow keys to move
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
                <div className="mb-0.5 flex items-center gap-1 text-[0.6875rem] font-medium text-gray-500">
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
                  <HighlightedText text={result.entry.text} positions={result.positions} />
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="max-w-prose @min-[760px]/panel:max-w-4xl @min-[1040px]/panel:max-w-none">
          {activeContent}
        </div>
      )}
    </SectionedModal>
  );
};

export default HelpModal;
