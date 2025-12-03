# Restore Geometry

A GNOME Shell extension that automatically restores window geometry (position and size) when windows are opened.

## Usage

1. Open Quick Settings (click the system menu in the top-right corner)
2. Look for the "Geometry" menu item
3. Click to expand and see all open windows
4. Toggle the switch next to any window to enable / disable restoring it
5. Optionally: click the lock icon to track the window dynamically

When the geometry is locked, the window will always restore to the geometry when it is locked (or enabled) upon opening, otherwise, the window will restore to the geometry before it is closed last time.

## Development

### Package

Create `restore-geometry.zip` by
```bash
make pack
```

## License

    Copyright (C) 2025  Xidorn Quan

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
