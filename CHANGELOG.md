## Qimchi Changelog

### v0.7.0 - 2026-08-16

- [Feature] The footer now shows the exact build version, including release-candidate tags, links to this changelog, and uses its pulsing dot to report whether the backend is reachable. Docker and all three desktop packages carry the release tag into the bundled frontend.
- [Fix] Instrument snapshots containing Python's non-standard `Infinity`, `-Infinity`, or `NaN` JSON constants now render as their corresponding JavaScript numeric values instead of appearing as a character-counted string.
- [Fix] Light/dark theme changes now apply atomically instead of briefly showing mixed-theme colours, and plot status, background-correction, and LineCut overlays have proper dark backgrounds.
- [Misc] Plot-clearing controls are more compact: Clear All uses a labelled trash icon, and the maximized LineCut preview no longer duplicates the main close action.
- [Misc] Preview CI reserves fast hosted runners for tests and builds, starts the bottleneck Windows build immediately, and makes untagged desktop builds explicit choices in manually started pipelines.
- [Feature] Dark mode: an app-wide dark theme (Atom One Dark palette) with a light/dark toggle in the branding footer. The choice is remembered across restarts and defaults to your system preference. Plots, the metadata JSON view, filters, and sliders all follow the theme; the Qimchi brand green is preserved in both modes.
- [Feature] Library: heart, trash and tag your measurements. Marks are saved to a local database and shown in the Explorer, with filters for hearted-only, hiding trash, and tags. Select several measurements and apply any of them at once.
- [Feature] Tags work like labels -- a measurement can carry several. Filter by them from the searchable Tags dropdown, or type `#tag` (or `#"two words"`) in the Explorer search box alongside an ordinary name search.
- [Feature] Marks follow a measurement even if you rename or move its file. Qimchi identifies a measurement by its qanary (formerly, qcutils) ID, a QCoDeS run GUID, or -- for datasets with neither -- a signature derived from the data itself. Nothing is written next to your files.
- [Feature] Notes are stored in the database instead of `.md` sidecars, so QCoDeS runs and artefacts can have notes too. Existing sidecar notes are imported on first open, and the `.md` mirror is still written unless `QIMCHI_NOTES_MD_EXPORT` is off.
- [Fix] Opening the same measurement in overlapping requests no longer causes a database error while its legacy note is imported.
- [Feature] Plots: new plots now appear on the left, matching the Basket. Pin a plot to hold it on its measurement while Next/Prev moves the others, so you can compare two datasets side by side.
- [Feature] Adding a measurement reproduces your custom plots for it, with the same variables and filters, instead of only the default heatmap and line plot. Plots whose variables are missing from the new measurement are skipped and named.
- [Feature] Tags can be renamed and deleted from the tag popover. Renaming keeps every measurement that carries the tag; deleting asks first and says how many datasets are affected. A name that is already taken is refused rather than quietly merging two tags into one.
- [Feature] Keyboard shortcuts for the Explorer selection: `Alt+Shift+H` hearts it and `Alt+Shift+T` trashes it, both across the whole multi-selection. They are listed with the rest in Help.
- [Feature] Exported images carry their measurement with them. Each PNG holds its tags, heart/trash state and IDs in the image metadata, and the same details are written to `metadata.json` inside the export zip.
- [Fix] The SQUAD Lab logo no longer fails to load in dark mode, and matches the light-mode size.
- [Fix] Updating no longer risks leaving the app showing the previous version's interface, or a blank window.
- [Fix] The app no longer writes its log into its own installation folder, which could make a silent update skip files.
- [Fix] Logs are kept across restarts and updates instead of the debug log being wiped on every launch, and are consolidated in `~/.qimchi/logs`.
- [Fix] Live qanary plots no longer flicker between live and disk state when a measurement finishes during a refresh, and the release test now exercises the published qanary package reproducibly.
- [Feature] Unwanted ongoing measurements can be hidden from the Live Measurements view without marking them finished or stopping their producer. Hidden runs stay ignored across restarts, can be restored or immediately undone, and are forgotten after they actually end.
- [Fix] The Docker image now includes database migrations and dataset readers, and nginx forwards the library and plot-transform APIs used by the frontend.
- [Fix] The first image export is no longer slow. The export workers and the browser they drive now start with the app, in the background, instead of on your first export -- a wait of several seconds that only ever hit the first plot you exported.
- [Fix] Plot titles are no longer dark on a dark background in dark mode.
- [Fix] The Live/Completed badge no longer stretches into a large square when plots are squarified.
- [Fix] The fade at the right edge of a full Basket slot no longer shows as a pale band in dark mode.
- [Fix] Qimchi no longer keeps contacting a measurement that has already finished, nor mistakes a later run that reused the same port for it. A finished measurement is read from disk straight away.
- [Misc] Live measurements are now discovered through `~/.qimchi/live_measurements.db` instead of `~/.qcutils/`. Upgrade Qimchi and your measurement packages together; once running measurements show up again, the old `~/.qcutils` folder can be deleted.
- [Misc] The companion measurement package qcutils is now called qanary. Measurements it identified are relabelled in the library database on first launch; your hearts, tags, trash and notes are unaffected.
- [Misc] Measurement metadata is read once and cached, so reopening a dataset no longer re-reads the file.
- [Misc] Windows uninstaller now offers to also remove the app's runtime data and cache (`~/.qimchi`: saved settings/window state, logs, and the ~150 MB downloaded Chrome used for image export). Your library, exported plots, notes, and datasets are left untouched.
- [Misc] CI now verifies the locked backend environment and runs frontend ESLint, Prettier, and production-build checks; frontend formatting and linting are available as npm scripts.
- [Misc] Backend regression coverage now spans every module, including downloads, exports, filters, notes, live data, library state, plotting, and application lifecycle, with a 75% coverage floor enforced in CI.
- [Misc] Hovering the filter button now lists the filters applied to that plot, by name and in the order they are applied.
- [Misc] Trashed measurements are quieter: greyed out, no red on the icon, and only Restore responds -- so a trashed dataset cannot be opened or plotted by accident.
- [Misc] Following a live measurement now transfers only the rows measured since the last refresh instead of the whole grid every time, which keeps a long sweep as cheap to watch at the end as at the start. Takes effect once your producers run qimchi-connect 0.3.0 or newer.
- [Misc] Dark mode colours -- panel titles, the Explorer tree, dataset icons -- come from theme tokens instead of values written into components, so the two themes stay in step. Dataset icons keep one colour in both themes, so a kind is recognisable either way.
- [Misc] Qimchi now runs against QCoDeS 0.59.

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
