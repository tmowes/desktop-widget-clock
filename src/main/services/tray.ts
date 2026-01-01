import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import Store from 'electron-store'
import { logAppEvent, openLogsFolder } from './logger'
import type { StoreSchema } from './store'

let tray: Tray | null = null

function getIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar', 'out', 'renderer', 'icon.png')
  }
  return join(__dirname, '../renderer/icon.png')
}

export function createTray(store: Store<StoreSchema>, onResetPosition: () => void): Tray {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 20, height: 20 })

  tray = new Tray(icon)
  tray.setToolTip('Desktop Widget Clock')

  updateTrayMenu(store, onResetPosition)
  logAppEvent('Tray created')

  return tray
}

export function updateTrayMenu(store: Store<StoreSchema>, onResetPosition: () => void): void {
  if (!tray) return

  const openAtLogin = store.get('openAtLogin')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Desktop Widget Clock',
      icon: nativeImage.createFromPath(getIconPath()).resize({ width: 20, height: 20 }),
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: 'Resetar posição',
      type: 'normal',
      click: () => {
        onResetPosition()
      },
    },
    {
      label: 'Abrir logs',
      type: 'normal',
      click: () => {
        logAppEvent('Opening logs folder')
        openLogsFolder()
      },
    },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: openAtLogin,
      click: () => {
        const newValue = !store.get('openAtLogin')
        store.set('openAtLogin', newValue)
        app.setLoginItemSettings({ openAtLogin: newValue, path: app.getPath('exe') })
        logAppEvent('Login item settings changed', { openAtLogin: newValue })
        updateTrayMenu(store, onResetPosition)
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Fechar',
      type: 'normal',
      role: 'quit',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
