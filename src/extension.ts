import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const SETTING_KEY = 'tracked-windows';

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SavedWindows {
  [wmclass: string]: WindowGeometry;
}

class RestoreGeometryExtension {
  private readonly _savedWindows: SavedWindows;
  private readonly _windowAddedId: number;
  private readonly _windowTrackers = new Map<Meta.Window, () => void>();
  private readonly _windowList: typeof WindowListToggle.prototype;

  private _pendingSave: number | undefined;

  constructor(private readonly _settings: Gio.Settings) {
    const json = this._settings.get_string(SETTING_KEY);
    this._savedWindows = JSON.parse(json);

    this._windowList = new WindowListToggle(this);
    Main.panel.statusArea.quickSettings.menu.addItem(this._windowList);

    this._windowAddedId = global.display.connect(
      'window-created',
      (_display: Meta.Display, window: Meta.Window) => {
        // Wait for window to be stable
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this._onWindowCreated(window);
          return GLib.SOURCE_REMOVE;
        });
      },
    );

    const windows = global.get_window_actors();
    for (const windowActor of windows) {
      const window = windowActor.get_meta_window();
      if (window) {
        const wmclass = window.get_wm_class();
        if (wmclass && this.isTracked(wmclass)) {
          this.trackWindow(window);
        }
      }
    }
  }

  destroy() {
    global.display.disconnect(this._windowAddedId);
    const disconnects = Array.from(this._windowTrackers.values());
    for (const disconnect of disconnects) {
      disconnect();
    }
    if (this._pendingSave) {
      GLib.source_remove(this._pendingSave);
      this._pendingSave = undefined;
      this._flushSettings();
    }
    this._windowTrackers.clear();
    this._windowList.destroy();
  }

  private _onWindowCreated(window: Meta.Window) {
    if (window.get_window_type() !== Meta.WindowType.NORMAL) {
      return;
    }
    const wmclass = window.get_wm_class();
    if (!wmclass) {
      return;
    }

    if (this.isTracked(wmclass)) {
      const actor = window.get_compositor_private() as Meta.WindowActor;
      const signal = actor.connect('first-frame', () => {
        const { x, y, width, height } = this._savedWindows[wmclass];
        window.move_resize_frame(true, x, y, width, height);
        this._trackWindow(window, wmclass);
        actor.disconnect(signal);
      });
    }
  }

  trackWindow(window: Meta.Window) {
    const wmclass = window.get_wm_class();
    if (!wmclass) {
      return;
    }

    const frame = window.get_frame_rect();
    const geometry: WindowGeometry = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    };

    this._savedWindows[wmclass] = geometry;
    this._saveSettings();

    this._trackWindow(window, wmclass);
  }

  untrackWindow(wmclass: string) {
    delete this._savedWindows[wmclass];
    this._saveSettings();

    for (const [window, disconnect] of this._windowTrackers.entries()) {
      if (window.get_wm_class() === wmclass) {
        disconnect();
      }
    }
  }

  isTracked(wmclass: string): boolean {
    return wmclass in this._savedWindows;
  }

  private _trackWindow(window: Meta.Window, wmclass: string) {
    if (this._windowTrackers.has(window)) {
      return;
    }

    const doUpdateGeometry = () => {
      const frame = window.get_frame_rect();
      const geometry: WindowGeometry = {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      };

      this._savedWindows[wmclass] = geometry;
      this._saveSettings();
    };

    let pendingUpdate: number | undefined;
    const updateGeometry = () => {
      if (pendingUpdate) {
        GLib.source_remove(pendingUpdate);
      }
      pendingUpdate = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        pendingUpdate = undefined;
        doUpdateGeometry();
        return GLib.SOURCE_REMOVE;
      });
    };

    const signalIds = [
      window.connect('position-changed', updateGeometry),
      window.connect('size-changed', updateGeometry),
      window.connect('unmanaged', () => {
        if (pendingUpdate) {
          GLib.source_remove(pendingUpdate);
          pendingUpdate = undefined;
        }
        disconnect();
      }),
    ];
    const disconnect = () => {
      for (const signalId of signalIds) {
        window.disconnect(signalId);
      }
      if (pendingUpdate) {
        GLib.source_remove(pendingUpdate);
        pendingUpdate = undefined;
        doUpdateGeometry();
      }
      this._windowTrackers.delete(window);
    };
    this._windowTrackers.set(window, disconnect);
  }

  private _saveSettings() {
    if (this._pendingSave) {
      GLib.source_remove(this._pendingSave);
    }
    this._pendingSave = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      this._pendingSave = undefined;
      this._flushSettings();
      return GLib.SOURCE_REMOVE;
    });
  }

  private _flushSettings() {
    const json = JSON.stringify(this._savedWindows);
    this._settings.set_string(SETTING_KEY, json);
  }

  getOpenWindows(): { window: Meta.Window; wmclass: string; tracked: boolean }[] {
    const trackableWindows = [];
    for (const actor of global.get_window_actors()) {
      const window = actor.get_meta_window();
      if (!window || window.get_window_type() !== Meta.WindowType.NORMAL) {
        continue;
      }
      const wmclass = window.get_wm_class();
      if (!wmclass) {
        continue;
      }
      trackableWindows.push({
        window,
        wmclass,
        tracked: this.isTracked(wmclass),
      });
    }

    trackableWindows.sort((a, b) => a.wmclass.localeCompare(b.wmclass));
    return trackableWindows;
  }
}

const WindowListToggle = GObject.registerClass(
class WindowListToggle extends QuickSettings.QuickMenuToggle {
  constructor(private readonly _extension: RestoreGeometryExtension) {
    super({
      title: 'Geometry',
      iconName: 'window-new-symbolic',
      toggleMode: false,
    });

    this.menu.setHeader('window-new-symbolic', 'Restore Geometry');
    this.menu.connect('open-state-changed', (_menu: typeof this.menu, open: boolean) => {
      if (open) {
        this.updateMenu();
      }
      return false;
    });
  }

  updateMenu() {
    this.menu.removeAll();

    const windows = this._extension.getOpenWindows();
    if (windows.length === 0) {
      const item = new PopupMenu.PopupMenuItem('No windows open');
      item.sensitive = false;
      this.menu.addMenuItem(item);
      return;
    }

    for (const { window, wmclass, tracked } of windows) {
      const title = window.get_title() || wmclass;
      const item = new PopupMenu.PopupSwitchMenuItem(`${title} (${wmclass})`, tracked);
      
      item.connect('toggled', () => {
        if (item.state) {
          this._extension.trackWindow(window);
        } else {
          this._extension.untrackWindow(wmclass);
        }
      });

      this.menu.addMenuItem(item);
    }
  }
});

export default class RestoreGeometry extends Extension {
  private _impl: RestoreGeometryExtension | undefined;

  enable() {
    this._impl?.destroy();
    this._impl = new RestoreGeometryExtension(this.getSettings());
  }

  disable() {
    this._impl?.destroy();
    this._impl = undefined;
  }
}
