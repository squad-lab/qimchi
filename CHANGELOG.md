## Qimchi Changelog

### v0.3.4 - 2026-02-21

- [Feature] Added axis swapping to Plots (both types)
- [Feature] New live measurements now auto-add to Basket and auto-create default plots in Viewer
- [Feature] Auto-apply filters from any filtered plot in Viewer to newly created plots
- [Feature] Added relayout data support to image exports - exports now preserve zoom/pan state
- [Feature] Added global Shift + R keybind to refresh DirTree; changed refresh button color to green
- [Fix] Ensure autoscaling of axes after swapping
- [Fix] Corrected targeting of Qimchi processes while exiting
- [Misc] Updated help bulb text to reflect current commands available in DirTree

### v0.3.3 - 2026-01-21

- [Feature] Auto-apply filters to new auto-plots (applies from only the first HeatMap and LinePlot present in Viewer)
- [Feature] Async image exports: in-memory task registration, polling, new endpoints; linting/formatting 
- [Fix] HeatMap title missing after filter application 
- [Fix] line() ordering flipped (switched to go.Figure - potential fix); removed unused f-strings
- [Fix] colorbar text in dark mode image export 
- [Misc] Linted and formatted DirTree 
