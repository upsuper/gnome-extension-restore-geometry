# Restore Geometry

A GNOME Shell extension that automatically restores window geometry (position and size) when windows are opened.

## Usage

### Quick Settings Menu

1. Open Quick Settings (click the system menu in the top-right corner)
2. Look for the "Window Geometry" menu item
3. Click to expand and see all open windows
4. Toggle the switch next to any window to start/stop tracking it

### Automatic Restoration

Once a window is tracked:
1. The extension saves its current position and size
2. When you move or resize the window, the new geometry is automatically saved
3. When you close and reopen the window, it will restore to the saved geometry

## Development

### Package

Create `restore-geometry.zip` by
```bash
make pack
```

## License

    Copyright (C) 2025  Upsuper

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
