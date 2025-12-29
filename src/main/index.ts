import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import Store from 'electron-store'
import { IPC } from '~/shared/ipc'
import { optimizer, setPackageAppUserModelId } from './utils'

interface WindowPosition {
  x: number
  y: number
}

interface StoreSchema {
  windowPosition: WindowPosition | null
}

const store = new Store<StoreSchema>({
  defaults: {
    windowPosition: null,
  },
})

const WINDOW_WIDTH = 160
const WINDOW_HEIGHT = 48

function getDefaultPosition(): WindowPosition {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { height } = primaryDisplay.workAreaSize
  return {
    x: 0,
    y: height - WINDOW_HEIGHT + 64,
  }
}

function createWindow(): void {
  const savedPosition = store.get('windowPosition')
  const position = savedPosition || getDefaultPosition()

  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition()
    store.set('windowPosition', { x, y })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    // mainWindow.webContents.openDevTools({ mode: 'undocked', activate: true })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  setPackageAppUserModelId('com.piktew.desktopwidgetclock')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => {
    console.log('pong', IPC.PING)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
