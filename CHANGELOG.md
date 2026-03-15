## Qimchi Changelog

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
