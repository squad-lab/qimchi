## Qimchi Changelog

### v0.6.2 - 2026-06-23

- [Feature] Desktop updater now selects platform-specific release assets: Windows installer, Linux AppImage, and macOS DMG.
- [Fix] Windows desktop Explorer no longer flashes console windows while `fd.exe` scans folders.

### v0.6.1 - 2026-06-23

- [Misc] GitLab CI uses larger hosted runners for Docker/Linux builds and the macOS DMG validation job.

### v0.6.0 - 2026-06-21

- [Feature] Self-contained desktop app (PyInstaller + pywebview) that bundles the backend and serves the SPA in a native window -- no separate install of Git/Python/Node required. Per-OS installers: Windows Inno Setup `qimchi-setup.exe`, Linux AppImage, macOS DMG. Download from the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases).
- [Feature] In-app auto-updater: on startup the desktop app checks GitLab Releases and offers a one-click "Update now" that downloads and runs the new installer.
- [Feature] Native folder picker: the Explorer "Load folder" button opens the OS folder dialog in the desktop app.
- [Feature] Desktop export: image-export zips are saved directly to `~/Downloads` (the embedded WebView cannot persist browser-initiated downloads).
- [Feature] First-run Chrome provisioning for Kaleido image export: if no system Chrome/Chromium is found, "Chrome for Testing" is downloaded once to `~/.qimchi/chrome`.
- [Feature] Desktop: app window opens maximized on launch.
- [Feature] Desktop: "Open debug log" button in the Notifications Log opens `~/.qimchi/qimchi_debug.log` live in a system terminal.
- [Feature] Basket: newly added items prepend to the top of the list.
- [Feature] Basket: independent/dependent variable rows scroll horizontally and reveal the full field list in a hover popup when the chips overflow the panel width.
- [Feature] Plots: default plot titles now show the variables (e.g. `Y vs X`) instead of the generic "Line Plot"/"Heat Map"; plot tab titles fall back to the (truncated) dataset name when no UUID is present.
- [Feature] Persistent panel layout: sidebar width and section heights are saved to localStorage and restored across reloads.
- [Fix] QCoDeS `.db` loading in the packaged app (bundle qcodes config data files).
- [Misc] GitLab CI builds the Windows installer and Linux AppImage and attaches them to tagged releases (a macOS DMG job is in place, pending a build runner).
- [Misc] Packaged build includes the datasets extra (NetCDF/HDF5/polars) and is built from `backend/.venv`.
- [Misc] Pinned the supported Node engine to `^20.19.0 || >=22.12.0` (Vite 8 / rolldown requirement).

### v0.5.2 - 2026-05-21

- [Feature] LineCuts enhancements: Better handling of filter inheritance; Swapped LineCuts vert/horiz shortcuts - X is now for a horizontal cut, and Y vertical
- [Feature] Added warnings to plots to show in case of a non-ideal fallback
- [Fix] Fixed Notes not showing up for non .zarr measurements
- [Fix] Fixed downloads for non .zarr datasets
- [Fix] Fixed and made Swap XY more stable for heatmaps
- [Fix] LivePlots - Some ops moved to threadpool to avoid blocking main thread
- [Fix] LivePlots - Better handling of transient data access errors (hidden from frontend)
- [Misc] Removed unique code for .zarr
- [Misc] LivePlots - Increased refresh time to 750ms
- [Misc] Smooth filter now `_fill_nans()` for data interpolation and safer application - shows a warning to the user

### v0.5.1 - 2026-04-21

- [Feature] Help modal: consolidated all help text into a single Help modal, added a tabbed interface for each major component with usage tips per component, and added `Shift+H` shortcut to toggle the Help Modal
- [Misc] Minor UI updates to Appearance and Filter modals
- [Misc] Linting & build fixes: Tailwind class updates, fixed several linter warnings (including state management inside `useEffect`), and changed chunk size limit to 8000 to suppress large build warning

### v0.5.0 - 2026-04-02

- [Feature] Dataset overhaul: unified backend loader (`data_loader.py`) with support for xarray DataTrees, NetCDF/HDF5, QCoDeS DBs (`load_by_id()`), flat csv/txt/dat files, and mixed SQLite containers
- [Feature] Zarr v3 support added while retaining compatibility for opening v2 datasets
- [Feature] Custom dataset support: added `docs/custom_datasets.md` with loader template and instructions for extending dataset support via xarray conversion
- [Feature] LineCuts (HeatMap): interactive horizontal/vertical slicing with live preview, side-panel visualization, backend plot creation, and improved robustness
- [Feature] Background correction (BG Corr): finalized support for LinePlots (constant + linear) and HeatMaps (constant, row/col mean, plane); filters are independent and composable
- [Feature] Keyboard shortcuts overhaul - added extensive keybinds:
  - `F` -> open Filters
  - `A` -> open Appearance
  - `M` -> toggle Maximized view
  - `R` -> reset selected plot
  - `N` -> send plot to Notes
  - `E` -> export images
  - `B` -> open BG Correction
  - `S` -> swap axes (HeatMaps)
  - `Shift+X` -> enter LineCut mode (HeatMaps)
  - `1–9` -> quick select plots in Viewer
  - `Del` -> remove selected plot
- [Feature] Viewer improvements: dataset cycling across multiple dataset types, improved filter handling, and reset-plot now fully reloads from backend
- [Feature] Explorer enhancements: path history navigation (back/forward), improved dataset detection utilities, and better QCoDeS DB navigation (datestamp/run grouping)
- [Feature] UI improvements: LineCut panel UX, maximized view controls, tooltips, and general responsiveness improvements
- [Fix] Reset plot now always refreshes from backend (no stale relayout/filter state)
- [Fix] Kaleido export performance: upgraded to 1.2.0 and applied persistent process fix
- [Fix] LineCut interaction issues: preview rendering, incorrect coordinates, visibility, and cursor-follow line behavior
- [Fix] Dataset explorer bugs: DirTree rendering, expansion state, QCoDeS DB refresh, and navigation inconsistencies
- [Fix] Background correction UI issues (non-editable lines, interaction bugs, layout fixes)
- [Fix] Plot handling when cycling datasets (added fallback for correct filter application)
- [Fix] Various UI inconsistencies, tooltip positioning, and defunct code paths
- [Misc] Removed `qcutils` as a core dependency; migrated `live_db` as shared module (WIP)
- [Misc] Installer updates: removed `qcutils` installation, added qcutils cleanup function, and updated installation verification to reflect changes
  - Removed `qcutils` installation from both installers + Docker and added cleanup function to remove if present
  - Added `--force-reinstall` (also `/force`, `-f`) to remove `$HOME/.qimchi` and do a clean install.
  - Dropped `requirements.txt` handling — prefer installing from `pyproject.toml` when present.
- [Misc] Upgraded frontend and backend dependencies:
  - Vite 8 (4x faster builds)
  - Updated `package*.json` and resolved migration issues
  - Pinned `lucide-react` and `react-resizable-panels` (~)
  - Updated core libs: Plotly, xarray, zarr, and dataset provider libraries to near latest versions
  - Using `~=` for most dependencies to allow minor updates while preventing breaking changes from now on
- [Misc] Enhanced dependency management:
  - Added dependency groups (`dev`, `test`) in `pyproject.toml`
  - Updated `requirements.txt` and `uv.lock`
- [Misc] Dependency upgrades across frontend/backend (Vite 8, Plotly, xarray, zarr, etc.) with migration fixes
- [Misc] Introduced dependency groups (`dev`, `test`) in `pyproject.toml`; updated `uv.lock`
- [Misc] Added backend tests for dataset and loader changes
- [Misc] Added `polars` dependency for flat file dataset support
- [Misc] Refactored dataset utilities (`datasetPaths.ts`) and related components for maintainability
- [Misc] Minor UI polish and cleanup across Viewer, PlotWrapper, Explorer, and sidebar

### v0.4.1 - 2026-03-21

- [Feature] Notes: Added rolling-log like note-pooling across Samples, UI/UX improvements (New icon, Open Notes from Basket, "Send to notes" export flow), and faster+safer saving flow
- [Feature] Notification Log: debounced fuzzy search, expandable JSON-tree details, optional `source`/`metadata` fields, and richer search across messages/types/sources
- [Feature] Basket & Composer Upgrade: dataset-card single + Ctrl/Cmd multi-select flow; shared indep/dep eligibility checks; disabled non-shared fields during multi-select; routed plot creation with per-dataset warnings and selection guidance UI
- [Feature] Global shortcuts: unified and simplified shortcuts (e.g. `P` for plotting, `H`/`L` to switch HeatMap/LinePlot in Composer)
- [Fix] Filters: Savgol's plot title now includes axis information (z/x/y)
- [Fix] Axis swapping and filtering: axis-swap behavior refined so filters apply to the current X/Y; removed axis swap on LinePlots; minor export status UX ("Starting export...")
- [Fix] Fixed multi-worker logging rollover concurrency bug by replacing RotatingFileHandler with ConcurrentRotatingFileHandler and update requirements (add `concurrent-log-handler==0.9.29` & `portalocker==3.2.0`)
- [Fix] Fixed qimchi.bat to reinstall backend deps if updated (checks `pyproject.toml` and `requirements.txt`)
- [Misc] Added helper utilities and hooks (`treeUtils`, `useGlobalShortcuts`, `datasetFieldSelectors`); backend API updates for export/filters/notes/models; front-end plot API and toast improvements


### v0.4.0 - 2026-03-15

- [Feature] Combined filter + data slicing application into a single endpoint; switched plot update payloads to `plot_ref`
- [Feature] Added plot status indicators (Live, Paused, Error, Completed); live plots now auto-transition to Completed to reduce `/plot/` call spam
- [Feature] Added many keyboard shortcuts (see Tips in various places in the UI)
- [Feature] Added Basket double-click to quickly add deps/indeps to Composer
- [Feature] Overhauled color scale range slider for HeatMaps - DualThumbSlider with responsive data-bounds display
- [Feature] Added transient blip protection to prevent error spam in live plots
- [Feature] Restored plot interactivity (zoom/pan) during live plots
- [Feature] Added toast notification log modal (check in footer)
- [Feature] Appearance Modal now surfaces 3 recommended HeatMap colorscales
- [Fix] [IMPORTANT] Fixed major post-mem-leak filter regressions
- [Fix] [IMPORTANT] Fixed major stuttering issues in live plotting by adding blip protection and optimizing update logic
- [Fix] Changed to a better way of computing Data Slider (slicer) steps to avoid precision issues
- [Fix] Normalized filtering by abs(z/y) across cases
- [Fix] Fixed LinePlot appearance settings not applying
- [Fix] Fixed Shift+R overriding Ctrl+Shift+R
- [Fix] Fixed Explorer search button padding
- [Fix] Fixed DirTree "Open Notes" action and Notifications Log initial positioning
- [Misc] [IMPORTANT] Changed to `float32` for all data processing and plotting to reduce memory usage and improve performance. No apparent loss in visual quality
- [Misc] Raise WebSocket max_size from 20 MB to 200 MB on both server and client
- [Misc] Centralized JSON sanitization and removed old/unused code
- [Misc] Notes UI polish + minor visual edits
- [Misc] Other UI polish + minor visual edits
- [Misc] Linting/formatting cleanup across backend and frontend

### v0.3.4 - 2026-02-21

- [Feature] Added axis swapping to Plots (both types)
- [Feature] New live measurements now auto-add to Basket and auto-create default plots in Viewer
- [Feature] Auto-apply filters from any filtered plot in Viewer to newly created plots
- [Feature] Added relayout data support to image exports - exports now preserve zoom/pan state
- [Feature] Added global Shift + R keybind to refresh DirTree; changed refresh button color to green
- [Fix] Ensure autoscaling of axes after swapping
- [Fix] Corrected targeting of Qimchi processes while exiting
- [Misc] Updated help bulb text to reflect current commands available in DirTree
- [Misc] Removed build signing from CI for now

### v0.3.3 - 2026-01-21

- [Feature] Auto-apply filters to new auto-plots (applies from only the first HeatMap and LinePlot present in Viewer)
- [Feature] Async image exports: in-memory task registration, polling, new endpoints; linting/formatting 
- [Fix] HeatMap title missing after filter application 
- [Fix] line() ordering flipped (switched to go.Figure - potential fix); removed unused f-strings
- [Fix] colorbar text in dark mode image export 
- [Misc] Linted and formatted DirTree 
