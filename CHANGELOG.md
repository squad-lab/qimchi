## Qimchi Changelog

### v0.7.0 - 2026-09-12

- [Feature] Complex variables, including HDF5 `r`/`i` pairs, are available as amplitude, phase in radians, real, and imaginary values. Library metadata is preserved for these measurements.
- [Feature] Text-labelled and coordinate-free dimensions have indexed sliders, allowing datasets such as fit results with a `param` axis to be plotted as heat maps.
- [Feature] Added a first-run walkthrough covering measurements, filters, appearance, line plots, and live data. It uses two bundled demos, can be reopened from Help, and offers to remove the demos and restore the previous Explorer location on exit.
- [Feature] The heat-map colour-scale picker shows swatches and previews the highlighted scale. Selection applies the scale; Escape cancels the preview.
- [Feature] The default live refresh interval is 300 ms, down from 750 ms. Settings > Live supports intervals from 100 ms to 1 s in 50 ms steps; short intervals may affect measurement stability.
- [Feature] Added plotting support for MATLAB `.mat` files, including v7.3 files. Ordered 1-D arrays are used as axes; scalars, text, and struct fields are shown as metadata.
- [Feature] Added bulk export for all Viewer plots. The output contains one archive per plot, preserves the current plot state and export settings, and records individual export failures without aborting the batch.
- [Feature] Added Export > Copy for copying a plot to the clipboard as a transparent PNG.
- [Feature] Selecting multiple Composer fields on one axis creates one plot per field.
- [Feature] Two measured quantities from the same sweep can be plotted against each other. Additional sweep dimensions are controlled by sliders.
- [Feature] Added oblique LineCuts. Press `O` or select Oblique, then choose the start and end points. A caution note beside Oblique and in Help describes the interpolation.
- [Feature] LineCut opens in a pop-up beside its plot instead of maximizing it. A right-click on the heat map locks the cut in place; clicking then keeps the locked cut.
- [Feature] Applied filters can be reordered in the Filters panel's Applied section, by dragging or with the arrows; the plot redraws in the new order. Filter tabs show each filter's position.
- [Feature] `Esc` exits the walkthrough after closing any active panel, menu, or maximized plot. If demos were added, the first press offers cleanup and the second keeps them.
- [Feature] Added an Atom One Dark app theme with a footer toggle. The saved choice defaults to the system theme and applies to plots, metadata, filters, and sliders.
- [Feature] Measurements can be hearted, trashed, and tagged. Marks are stored in the local library database, support multi-selection, and can be filtered in the Explorer.
- [Feature] Measurements can have multiple tags. Tags can be filtered from the Tags menu or with `#tag` and `#"two words"` Explorer searches.
- [Feature] Measurement marks survive file moves and renames when a qanary ID, QCoDeS GUID, or data-derived signature is available.
- [Feature] Notes are stored in the library database, adding support for QCoDeS runs and other artefacts. Existing sidecars are imported; `.md` mirroring remains enabled unless `QIMCHI_NOTES_MD_EXPORT` is disabled.
- [Feature] New plots appear on the left. Pinned plots keep their measurement while Next/Prev updates unpinned plots.
- [Feature] Adding a measurement recreates the current default and custom plots with their variables and filters. Incompatible plots are skipped; default plots are used when none match.
- [Feature] Tags can be renamed and deleted from the tag popover. Rename conflicts are rejected, and deletion reports the number of affected datasets before confirmation.
- [Feature] Added `Alt+Shift+H` and `Alt+Shift+T` to heart or trash the current Explorer selection.
- [Feature] Folders can be hearted, trashed, and tagged. Folder marks apply recursively to descendants; folder identity remains path-based.
- [Feature] PNG exports embed library state and measurement IDs. Export archives include the same data in `metadata.json`.
- [Feature] Running measurements can be hidden from Live Measurements without stopping or completing them. Hidden runs persist across restarts and are removed from the hidden list when they finish.
- [Feature] Axis and colour-bar labels include dataset units and mathematical typesetting. Filters update units, and displayed values use an appropriate engineering prefix.
- [Feature] Added a Scale filter for Y and Z data with multiplication, inversion, conductance/resistance quantum units, inferred units, and label overrides.
- [Feature] Axis and colour-bar labels can be edited in place and remain unchanged when the plot rescales.
- [Feature] Plots use Fira Sans. Exported images embed the application and mathematics fonts.
- [Feature] Replaced the sidebar with an accordion rail for Explorer, Metadata, Notes, and Live Measurements. `Alt+1` through `Alt+4` open the panes directly.
- [Feature] `Shift+F` opens a full-window Explorer with measurement modification dates; `Esc` closes it.
- [Feature] Moved Live Measurements from an Explorer mode to its own sidebar pane.
- [Feature] Added control ribbons to Basket, Composer, and Viewer. `Alt+B` and `Alt+C` toggle Basket and Composer, with state preserved across restarts.
- [Feature] Help supports fuzzy search and keyboard navigation and opens in a wider window.
- [Feature] Added persistent app zoom controls to the sidebar rail, including a 100% reset.
- [Feature] QCoDeS and Quantify measurements show source-specific metadata. QCoDeS entries include run ID, GUID, sample, experiment, station snapshot, and run name.
- [Feature] QCoDeS notes are associated with the database. Selecting a database shows notes from all its runs.
- [Feature] Measurement downloads include the dataset's library record as JSON.
- [Feature] The Explorer sorts newest measurements first by default.
- [Feature] Updates download in the background with progress shown on the sidebar rail. Settings > Updates supports manual checks, downloads, installation, preview releases, and deferred reminders.
- [Feature] Added an R_in Correction heat-map filter using V_S = V_b − I × R_in.
- [Feature] Filter presets can be saved, applied, updated, reverted, renamed, and removed from the Filters panel.
- [Feature] Configured filters can be switched off and back on from the Applied list without losing their settings or position.
- [Feature] Settings > Plots sets the initial LineCut direction.
- [Feature] Settings can be searched by section, control, or related term. Results support keyboard navigation and open the matching setting directly.
- [Feature] On a live heat map, LineCut can follow the row or column currently being measured. It advances with the frontier, follows swapped axes, and is unavailable after the measurement completes.
- [Feature] Settings > Developer can save Qimchi's logs and recent crash reports as one zip file for a bug report. Crash reports from the last two weeks are included by default and can be excluded.
- [Feature] qanary parameters can be pinned from Metadata and tracked across measurements.
- [Feature] The update prompt now shows both versions and formatted release notes.
- [Feature] Added persistent Settings for theme, zoom, plot layout and behavior, Explorer sorting, live-basket behavior, image export, and desktop updates. Open with `Shift+S` or the sidebar gear.
- [Feature] Automatic plotting now creates a HeatMap when possible and otherwise a LinePlot. Settings > Plots can select HeatMap or LinePlot, both, or neither.
- [Feature] Each plot has an independent 33/50/66/100% width control. Viewer-wide width controls remain available, and Disk and Notes exports share one menu.
- [Feature] Plots can be reordered by dragging the ribbon handle or using its keyboard controls. Plot widths are preserved, with edge-triggered Viewer scrolling during drag.
- [Feature] Settings can be exported to and imported from JSON. Import replaces all settings and restores defaults for missing or invalid values.
- [Feature] Settings can define default colormap, axes, grid, ticks, lines, and markers. Changes update open plots unless locally overridden; Reset returns to these defaults.
- [Feature] Theme, zoom, plot width, square-plot, and Explorer sort controls update the same persistent settings.
- [Feature] Added a persistent Reverse option for heat-map colour scales, including exports.
- [Feature] Appearance shows colour-range values with data units and SI prefixes.
- [Feature] LineCut previews update with live data and immediately when switching between X and Y. Unmeasured points no longer offset the slice.
- [Feature] The Basket is limited to 50 measurements and shows a warning and status icon when full.
- [Feature] The footer shows the full build version, including release-candidate tags, links to the changelog, and indicates backend connectivity. Docker and desktop packages pass the release tag to the frontend.
- [Fix] The app log now records the whole session; it had stopped keeping Qimchi's own messages after startup.
- [Fix] LineCut uses the selected direction immediately, without requiring the heat map to redraw first.
- [Fix] Rotated heat-map axes and titles now account for axis step sizes. LineCut previews and results follow the rotated image correctly.
- [Fix] Long Help entries wrap below their titles with consistent spacing.
- [Fix] The live-refresh slider no longer changes value when its reset button appears.
- [Fix] Metadata and Explorer search inputs use the same font size.
- [Fix] Wide tooltips are repositioned to remain inside the window.
- [Fix] Swapping heat-map axes no longer hides the plot ribbon while it is hovered.
- [Fix] LineCut preserves zoom when switching direction or starting an oblique cut.
- [Fix] Deep zoom no longer triggers repeated redraws when the axis unit prefix changes.
- [Fix] LineCut guides and heat-map hover labels now track the pointer without redrawing the heat map.
- [Fix] Data-slider updates are debounced by 50 ms instead of 80 ms.
- [Fix] Data sliders can reach their maximum when the step does not divide the range exactly.
- [Fix] Applying or removing a filter no longer resets data-slider positions, and removing the last filter keeps the plot on the slider's slice.
- [Fix] The Filters panel's Sliders and Applied tabs follow the dark theme.
- [Fix] Savitzky–Golay filtering now defaults to the X axis.
- [Fix] Starting the walkthrough clears the Composer, so leftover axes no longer block its steps.
- [Fix] The plot selected with `1`-`9` has a clearly visible blue outline.
- [Fix] Long notifications and notification-log entries wrap within their containers.
- [Fix] Help and Settings no longer overlap the walkthrough. Closing them resumes the current step; starting the walkthrough closes either modal.
- [Fix] The second walkthrough demo cannot be opened before its step.
- [Fix] `Ctrl/Cmd` with `+` or `−` now controls app zoom on macOS. Help also lists the LineCut `X`, `Y`, and `O` shortcuts.
- [Fix] Plots only show sliders for dimensions used by their variables.
- [Fix] Long plot errors and Windows paths remain inside the error card.
- [Fix] Removed Plotly's external "Share chart" action from the toolbar.
- [Fix] Open Appearance and Filters panels remain attached and unclipped while their plot is dragged.
- [Fix] The Composer reports a missing Z field instead of requesting an invalid heat map.
- [Fix] Invalid plot requests show one error and do not add an empty plot card.
- [Fix] Variable-compatibility errors identify the affected variables and sweep dimensions.
- [Fix] Rotated heat-map labels no longer produce LaTeX brace errors and include units when both axes share them.
- [Fix] Filters, tags, and measurement details wrap in exported images without splitting filter names.
- [Fix] Instrument snapshot values containing Python `Infinity`, `-Infinity`, or `NaN` constants are parsed as numbers instead of strings.
- [Fix] Theme changes no longer show mixed light and dark colours during the transition. Plot status, background-correction, and LineCut overlays now have dark-theme backgrounds.
- [Fix] Concurrent requests no longer cause a database error during legacy-note import.
- [Fix] The SQUAD Lab logo loads at the correct size in dark mode.
- [Fix] Updates no longer leave a stale or blank frontend.
- [Fix] Logs are no longer written to the installation directory, preventing skipped files during silent updates.
- [Fix] Logs persist across launches and updates under `~/.qimchi/logs`.
- [Fix] Live qanary plots no longer alternate between live and disk data when a measurement finishes during refresh. Release tests use the published qanary package.
- [Fix] The Docker image includes migrations and dataset readers; nginx forwards the library and plot-transform APIs.
- [Fix] Image-export workers and their browser start in the background with the app, removing the delay from the first export.
- [Fix] Plot titles use a visible colour in dark mode.
- [Fix] Live/Completed badges keep their intended size in square plot layouts.
- [Fix] Full Basket slots no longer show a light fade in dark mode.
- [Fix] Finished measurements are read from disk and no longer polled or confused with later runs that reuse the same port.
- [Fix] Colour-bar margins and font size adapt to long labels on screen and in exports.
- [Fix] Hover labels show plain axis text instead of raw LaTeX.
- [Fix] Live colour bars no longer shift the plot as values grow, and Plotly's title placeholder is hidden.
- [Fix] Explorer refreshes preserve the tree and current position instead of replacing the pane with a spinner.
- [Fix] Explorer refreshes restore expanded folders, and Expand/Collapse All follows the current folder after navigation.
- [Fix] Full-window Explorer covers Plotly toolbars.
- [Fix] Image exports that produce no images now report an error instead of returning a logs-only archive.
- [Fix] Maximized plots no longer repeat the measurement name in the plot title.
- [Fix] Corrected dark-mode styles for dropdowns, the notes editor, sidebar tabs, hover states, and chip borders.
- [Fix] The Explorer search focus ring is no longer clipped, and the icon rail no longer scrolls horizontally.
- [Fix] Axis-title editing works on newly rendered plots.
- [Fix] Metadata loads from xarray DataTree datasets.
- [Fix] The Metadata pane shows only qanary's four metadata sections; other attributes remain in the Basket.
- [Fix] LineCut filters preserve the selected slice, including for PolyFit.
- [Fix] Major and minor grid settings are now rendered on plots.
- [Fix] Heat maps no longer inherit colour ranges from previously opened plots; live ranges continue to update.
- [Fix] Live colour bars retain their SI prefix while data points are unmeasured.
- [Fix] Swapping axes during LineCut no longer collapses the heat map.
- [Fix] Zoom and pan persist through filter results, live refreshes, and background-correction updates.
- [Fix] Live-plot reset and filter changes no longer restore stale state or blank the plot while loading.
- [Fix] Filter changes made during an active update are queued and applied afterward.
- [Fix] The Windows app reloads after a WebView2 page crash and logs the event. Automatic reload stops after three crashes in five minutes.
- [Fix] Live plots continue refreshing at full speed when the Windows app is minimized or in the background.
- [Fix] Tooltips near the right edge no longer wrap after every word.
- [Fix] Closing a plot releases its data and browser resources.
- [Fix] Live refreshes release previous figures instead of accumulating memory.
- [Fix] Axes and colour bars show at least two labelled values.
- [Fix] Closing the desktop window terminates the app on Windows and macOS.
- [Fix] Windows updates now open the standard installer after Qimchi closes.
- [Fix] macOS updates now replace and reopen Qimchi, with manual installation as a fallback.
- [Fix] macOS disk images now include an Applications shortcut.
- [Fix] Image export now starts Chrome correctly in macOS and Linux desktop builds.
- [Fix] Complex phases are unwrapped across measured points.
- [Fix] LineCut preview titles and hover labels now use the heat map's labels, units, and colours.
- [Fix] Heat-map hover labels now reflect filters that change the plotted quantity.
- [Fix] Heat-map hover labels stay above the LineCut guide.
- [Fix] Composer heat maps now place the selected X and Y fields on the correct axes.
- [Fix] Export timings are now optional under Settings > Developer.
- [Fix] Image export can download Chrome and stops failed startup attempts after two minutes.
- [Fix] Measurement notes, pooled sample notes, and dataset downloads now resolve live `memory://` measurements correctly. Measurement notes remain available before a live run has a disk path.
- [Fix] Updating between release candidates no longer loads the previous frontend.
- [Fix] Warning and error boxes are readable in dark mode, and Notification Log buttons no longer flash on hover.
- [Misc] Every log line is timestamped. The logs record memory use once a minute (Qimchi, export workers, Chrome and the WebView), page errors, slow requests and a frozen interface, and routine polling no longer fills them.
- [Misc] The notification log opens beside its rail button on the left.
- [Misc] Renamed the Viewer toggle to "Show only live and pinned plots".
- [Misc] Clear All now uses a labelled trash icon, and the maximized LineCut preview no longer duplicates the close action.
- [Misc] Preview CI starts the Windows build immediately, reserves fast runners for tests and builds, and makes untagged desktop builds opt-in.
- [Misc] Live measurement discovery now uses `~/.qimchi/live_measurements.db`. Update Qimchi and its measurement packages together before removing `~/.qcutils/`.
- [Misc] Renamed qcutils to qanary. Existing measurement records are migrated without changing hearts, tags, trash, or notes.
- [Misc] Measurement metadata is cached after the first read.
- [Misc] The Windows uninstaller can remove runtime data and cache while preserving the library, exports, notes, and datasets.
- [Misc] CI verifies the locked backend environment and runs frontend lint, formatting, and production-build checks. Matching npm scripts are available locally.
- [Misc] Backend tests cover all modules and enforce a 75% coverage floor.
- [Misc] Hovering the filter button shows the plot's applied filters in order.
- [Misc] Trashed measurements are greyed out and only allow Restore; they cannot be opened or plotted.
- [Misc] Live refreshes transfer only rows added since the previous refresh when producers use qimchi-connect 0.3.0 or newer.
- [Misc] Dark-mode component colours use shared theme tokens. Dataset types retain the same icon colour in both themes.
- [Misc] Updated QCoDeS support to 0.59.
- [Misc] Release-candidate installations receive later previews and the corresponding stable release. Stable installations do not receive previews.
- [Misc] Added desktop installation instructions for Windows, Linux, and macOS, including unsigned-app prompts. Removed the obsolete Windows clone-and-build scripts.
- [Misc] Reduced a 210-measurement Explorer scan from 1.06 s to 0.19 s by avoiding zarr chunk reads, moving scans off the request loop, and caching dataset size and timestamp.
- [Misc] Large baskets no longer block other panels while redrawing. Explorer starts collapsed and renders only visible rows.
- [Misc] Added Vitest and Playwright frontend test suites with CI coverage thresholds.
- [Misc] CI applies and pushes lint and formatting fixes to the branch.
- [Misc] Moved Docker files to `docker/` and platform build scripts to `scripts/`; removed obsolete Windows build scripts.
- [Misc] Release downloads include the version in their filenames, for example `qimchi-setup-v0.7.0.exe`.
- [Misc] Redrawn plots release their previous chart, and stored state for plots from earlier sessions is dropped at startup.
- [Misc] Closing a plot removes its stored filters, sliders, and appearance. Notifications are limited to 500 entries, and Explorer history is bounded.
- [Misc] Update checks are recorded step-by-step in the debug log.
- [Misc] Open debug log starts at the latest 200 lines and follows new output. Windows uses its terminal; macOS and Linux use `less` or fall back to `tail`.
- [Misc] Filter summaries use the display names from the Filters panel, such as "Diff along Y".

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
