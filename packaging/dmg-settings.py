"""
Branded Finder layout, written by dmgbuild without a live Finder session.

The build passes absolute app and assets paths via dmgbuild's -D arguments.

Keep the window and icon coordinates aligned with assets/dmg-background.svg.

"""

from pathlib import Path

_app = Path(defines["app"])  # noqa: F821 - provided by dmgbuild
_assets = Path(defines["assets"])  # noqa: F821 - provided by dmgbuild
if not _app.is_dir() or _app.name != "Qimchi.app":
    raise ValueError(f"Expected the built Qimchi.app bundle, got {_app}")

format = "UDZO"
filesystem = "HFS+"
volume_name = "Qimchi"
files = [str(_app)]
symlinks = {"Applications": "/Applications"}
hide_extensions = ["Qimchi.app"]
background = str(_assets / "dmg-background.png")
if not Path(background).is_file():
    raise FileNotFoundError(background)

# dmgbuild combines the adjacent @2x PNG into a Retina background on macOS.
window_rect = ((200, 120), (800, 420))
default_view = "icon-view"
show_toolbar = False
show_status_bar = False
show_tab_view = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True
include_list_view_settings = False
arrange_by = None
grid_spacing = 80
scroll_position = (0, 0)
icon_size = 128
text_size = 16
label_pos = "bottom"
icon_locations = {"Qimchi.app": (200, 200), "Applications": (600, 200)}

_icon = _app.parent / "qimchi-logo.icns"
if not _icon.is_file():
    raise FileNotFoundError(f"Required Qimchi volume icon is missing: {_icon}")
icon = str(_icon)
