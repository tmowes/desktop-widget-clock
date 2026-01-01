import { app, BrowserWindow } from 'electron'
import { setupIpcHandlers } from './services/ipc'
import { logAppEvent, logError, logWindowEvent } from './services/logger'
import { store } from './services/store'
import { createTray } from './services/tray'
import { optimizer, setPackageAppUserModelId } from './services/utils'
import {
  createWindow,
  getMainWindow,
  resetWindowPosition,
  setupDisplayEvents,
} from './services/window'

logAppEvent('App starting', {
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  argv: process.argv,
  execPath: process.execPath,
  cwd: process.cwd(),
  platform: process.platform,
  arch: process.arch,
})

// // ============================================
// // SQUIRREL EVENTS (Windows installer)
// // ============================================
// if (process.platform === 'win32') {
//   const squirrelCommand = process.argv[1]
//   if (squirrelCommand) {
//     const isSquirrelEvent = [
//       '--squirrel-install',
//       '--squirrel-updated',
//       '--squirrel-uninstall',
//       '--squirrel-obsolete',
//       '--squirrel-firstrun',
//     ].includes(squirrelCommand)

//     if (isSquirrelEvent) {
//       logAppEvent('Squirrel event detected, quitting', { command: squirrelCommand })
//       app.quit()
//     }
//   }
// }

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  logAppEvent('Another instance is running, quitting')
  app.quit()
} else {
  logAppEvent('Got single instance lock')

  app.on('second-instance', (_event, commandLine) => {
    logAppEvent('Second instance attempted', { commandLine })
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  if (!gotTheLock) return

  logAppEvent('App ready')

  setPackageAppUserModelId('com.piktew.desktopwidgetclock')

  app.on('browser-window-created', (_, window) => {
    logWindowEvent('browser-window-created', { id: window.id, title: window.getTitle() })
    optimizer.watchWindowShortcuts(window)
  })

  const openAtLogin = store.get('openAtLogin')
  logAppEvent('Setting login item settings', { openAtLogin, exePath: app.getPath('exe') })
  app.setLoginItemSettings({
    openAtLogin: app.isPackaged ? openAtLogin : false,
    path: app.getPath('exe'),
    args: [],
  })

  setupIpcHandlers()

  createTray(store, () => resetWindowPosition(store))

  createWindow(store)

  setupDisplayEvents(store)

  app.on('activate', () => {
    logAppEvent('activate')
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(store)
    }
  })
})

app.on('window-all-closed', () => {
  logAppEvent('window-all-closed, quitting app')
  app.quit()
})

app.on('before-quit', () => {
  logAppEvent('before-quit')
})

app.on('will-quit', () => {
  logAppEvent('will-quit')
})

process.on('uncaughtException', (error) => {
  logError('PROCESS', 'uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  logError('PROCESS', 'unhandledRejection', reason)
})
