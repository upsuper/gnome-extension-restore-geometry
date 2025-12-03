import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import St from 'gi://St';
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
  locked?: boolean;
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

    for (const windowActor of global.get_window_actors()) {
      const window = windowActor.get_meta_window();
      if (window) {
        const wmclass = window.get_wm_class();
        if (wmclass && this.isSaved(wmclass) && !this.isLocked(wmclass)) {
          this._startTracking(window, wmclass);
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

    if (!this.isSaved(wmclass)) {
      return;
    }

    const actor = window.get_compositor_private() as Meta.WindowActor;
    const signal = actor.connect('first-frame', () => {
      const { x, y, width, height } = this._savedWindows[wmclass];
      window.move_resize_frame(true, x, y, width, height);
      if (!this.isLocked(wmclass)) {
        this._startTracking(window, wmclass);
      }
      actor.disconnect(signal);
    });
  }

  isSaved(wmclass: string): boolean {
    return wmclass in this._savedWindows;
  }

  isLocked(wmclass: string): boolean {
    return this._savedWindows[wmclass]?.locked ?? false;
  }

  updateWindow(window: Meta.Window, saved: boolean, locked: boolean) {
    const wmclass = window.get_wm_class();
    if (!wmclass) {
      return;
    }

    if (!saved) {
      delete this._savedWindows[wmclass];
      this._saveSettings();
      this._stopTracking(wmclass);
      return;
    }

    const frame = window.get_frame_rect();
    this._savedWindows[wmclass] = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      locked,
    };
    this._saveSettings();
    if (!locked) {
      this._startTracking(window, wmclass);
    } else {
      this._stopTracking(wmclass);
    }
  }

  private _startTracking(window: Meta.Window, wmclass: string) {
    if (this._windowTrackers.has(window)) {
      return;
    }

    const doUpdateGeometry = () => {
      const frame = window.get_frame_rect();
      this._savedWindows[wmclass] = {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        locked: false,
      };
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

  private _stopTracking(wmclass: string) {
    for (const [window, disconnect] of this._windowTrackers.entries()) {
      if (window.get_wm_class() === wmclass) {
        disconnect();
      }
    }
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

  getOpenWindows(): {
    window: Meta.Window;
    wmclass: string;
    saved: boolean;
    locked: boolean;
  }[] {
    const windows = [];
    for (const actor of global.get_window_actors()) {
      const window = actor.get_meta_window();
      if (!window || window.get_window_type() !== Meta.WindowType.NORMAL) {
        continue;
      }
      const wmclass = window.get_wm_class();
      if (!wmclass) {
        continue;
      }
      windows.push({
        window,
        wmclass,
        saved: this.isSaved(wmclass),
        locked: this.isLocked(wmclass),
      });
    }

    windows.sort((a, b) => a.wmclass.localeCompare(b.wmclass));
    return windows;
  }
}

const LockableSwitchMenuItem = GObject.registerClass(
  { Signals: {
    'changed': { param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_BOOLEAN] },
  } },
class LockableSwitchMenuItem extends PopupMenu.PopupBaseMenuItem {
  private _switch: typeof PopupMenu.Switch.prototype;
  private _lockButton: St.Button;
  private _lockIcon: St.Icon;

  constructor(text: string, active: boolean, private _locked: boolean) {
    super();

    const label = new St.Label({ text, y_align: Clutter.ActorAlign.CENTER, x_expand: true });
    this.add_child(label);
    this.label_actor = label;

    this._lockButton = new St.Button({
      can_focus: true,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._lockIcon = new St.Icon({
      style_class: 'popup-menu-icon',
      icon_size: 16,
    });
    this._lockButton.set_child(this._lockIcon);
    const setLocked = (locked: boolean) => {
      this._locked = locked;
      this._lockIcon.icon_name = locked
        ? 'changes-prevent-symbolic'
        : 'changes-allow-symbolic';
    };
    setLocked(this._locked);
    this._lockButton.connect('clicked', () => {
      setLocked(!this._locked);
      this.emit('changed', this._switch.state, this._locked);
    });
    this._lockButton.visible = active;
    this.add_child(this._lockButton);

    this._switch = new PopupMenu.Switch(active);
    this._switch.connect('notify::state', () => {
      const state = this._switch.state;
      setLocked(state);
      this.emit('changed', state, this._locked);
      this._checkAccessibleState();
    });
    this.add_child(this._switch);
    this._switch.bind_property('state', this._lockButton, 'visible', null);

    this.accessible_role = Atk.Role.CHECK_MENU_ITEM;
    this._checkAccessibleState();
  }

  activate() {
    if (this._switch.mapped) {
      this._switch.toggle();
    }
  }

  private _checkAccessibleState() {
    switch (this._switch.state) {
      case true:
        this.add_accessible_state(Atk.StateType.CHECKED);
        break;
      case false:
        this.remove_accessible_state(Atk.StateType.CHECKED);
        break;
    }
  }
});

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

    for (const { window, wmclass, saved, locked } of windows) {
      const title = window.get_title() || wmclass;
      const item = new LockableSwitchMenuItem(`${title} (${wmclass})`, saved, locked);
      item.connect('changed', (_item: typeof item, state: boolean, locked: boolean) => {
        this._extension.updateWindow(window, state, locked);
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
