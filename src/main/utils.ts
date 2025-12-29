import { app, BrowserWindow, ipcMain, session } from 'electron'

export function setPackageAppUserModelId(id: string): void {
  if (process.platform === 'win32' && app.isPackaged) {
    app.setAppUserModelId(id)
  }
}

export function setAutoLaunch(auto: boolean): boolean {
  if (process.platform === 'linux') {
    return false
  }

  const isOpenAtLogin = (): boolean => {
    return app.getLoginItemSettings().openAtLogin
  }

  if (isOpenAtLogin() !== auto) {
    app.setLoginItemSettings({ openAtLogin: auto })
    return isOpenAtLogin() === auto
  } else {
    return true
  }
}

export function skipProxy(): Promise<void> {
  return session.defaultSession.setProxy({ mode: 'direct' })
}

export type shortcutOptions = {
  /**
   * Use `ESC` key to close window, default `false`.
   */
  escToCloseWindow?: boolean
  /**
   * Zoom in (`Minus + CommandOrControl`) or zoom out(`Equal + Shift + CommandOrControl`), default `false`.
   */
  zoom?: boolean
}

export interface Optimizer {
  /**
   * Default open or close DevTools by `F12` in development and
   * ignore `CommandOrControl + R` in production.
   *
   * Use `shortcutOptions` to control more shortcuts.
   */
  watchWindowShortcuts: (window: BrowserWindow, shortcutOptions?: shortcutOptions) => void
  /**
   * If use a frameless window which hide the system's native window controls,
   * we may need to create custom window controls in HTML.
   *
   * The frameless window ipc allow the renderer process to control the
   * browser window.
   *
   * The ipc channel named `win:invoke`.
   *
   * For Example:
   *
   * ```
   * ipcRenderer.send('win:invoke', 'show')
   * ipcRenderer.send('win:invoke', 'showInactive')
   * ipcRenderer.send('win:invoke', 'min')
   * ipcRenderer.send('win:invoke', 'max')
   * ipcRenderer.send('win:invoke', 'close')
   * ```
   */
  registerFramelessWindowIpc: () => void
}

export const optimizer: Optimizer = {
  watchWindowShortcuts(window, shortcutOptions?): void {
    if (!window) return
    const { webContents } = window
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {}
    webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') {
        if (app.isPackaged) {
          if (input.code === 'KeyR' && (input.control || input.meta)) event.preventDefault()
          if (
            input.code === 'KeyI' &&
            ((input.alt && input.meta) || (input.control && input.shift))
          ) {
            event.preventDefault()
          }
        } else {
          if (input.code === 'F12') {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools()
            } else {
              webContents.openDevTools({ mode: 'undocked' })
              console.log('Open dev tool...')
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === 'Escape' && input.key !== 'Process') {
            window.close()
            event.preventDefault()
          }
        }
        if (!zoom) {
          if (input.code === 'Minus' && (input.control || input.meta)) event.preventDefault()
          if (input.code === 'Equal' && input.shift && (input.control || input.meta))
            event.preventDefault()
        }
      }
    })
  },
  registerFramelessWindowIpc(): void {
    ipcMain.on('win:invoke', (event, action) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        if (action === 'show') {
          win.show()
        } else if (action === 'showInactive') {
          win.showInactive()
        } else if (action === 'min') {
          win.minimize()
        } else if (action === 'max') {
          const isMaximized = win.isMaximized()
          if (isMaximized) {
            win.unmaximize()
          } else {
            win.maximize()
          }
        } else if (action === 'close') {
          win.close()
        }
      }
    })
  },
}
