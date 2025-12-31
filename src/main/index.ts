import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron'
import Store from 'electron-store'
import { IPC } from '~/shared/ipc'
import { optimizer, setPackageAppUserModelId } from './utils'

// ============================================
// LOGGING SYSTEM
// ============================================
const LOG_DIR = join(app.getPath('userData'), 'logs')
const LOG_FILE = join(LOG_DIR, 'window-events.log')
const MAX_LOG_SIZE = 1024 * 1024 // 1MB

function ensureLogDirectory(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function rotateLogIfNeeded(): void {
  try {
    if (existsSync(LOG_FILE)) {
      const stats = statSync(LOG_FILE)
      if (stats.size > MAX_LOG_SIZE) {
        const backupPath = join(LOG_DIR, `window-events-${Date.now()}.log.old`)
        renameSync(LOG_FILE, backupPath)
      }
    }
  } catch {
    // Ignore rotation errors
  }
}

function log(
  level: 'INFO' | 'WARN' | 'ERROR',
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` | ${JSON.stringify(data)}` : ''
  const logLine = `[${timestamp}] [${level}] [${category}] ${message}${dataStr}\n`

  try {
    ensureLogDirectory()
    rotateLogIfNeeded()
    appendFileSync(LOG_FILE, logLine, 'utf-8')
  } catch (error) {
    console.error('Failed to write log:', error)
  }
}

function logWindowEvent(event: string, data?: Record<string, unknown>): void {
  log('INFO', 'WINDOW', event, data)
}

function logAppEvent(event: string, data?: Record<string, unknown>): void {
  log('INFO', 'APP', event, data)
}

function logError(category: string, message: string, error?: unknown): void {
  const errorData =
    error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) }
  log('ERROR', category, message, errorData)
}

interface WindowPosition {
  x: number
  y: number
}

interface StoreSchema {
  windowPosition: WindowPosition | null
  openAtLogin: boolean
}

const store = new Store<StoreSchema>({
  defaults: {
    windowPosition: null,
    openAtLogin: true,
  },
})

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

function getIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar', 'out', 'renderer', 'icon.png')
  }
  return join(__dirname, '../renderer/icon.png')
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 20, height: 20 })

  tray = new Tray(icon)
  tray.setToolTip('Desktop Widget Clock')

  updateTrayMenu()
}

function updateTrayMenu(): void {
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
        resetWindowPosition()
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
        updateTrayMenu()
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

const WINDOW_WIDTH = 160
const WINDOW_HEIGHT = 47

const DESIRED_POSITION: WindowPosition = { x: 0, y: 1696 }

function getDefaultPosition(): WindowPosition {
  return DESIRED_POSITION
}

function isPositionVisible(position: WindowPosition): boolean {
  const displays = screen.getAllDisplays()

  for (const display of displays) {
    const { x, y, width, height } = display.workArea
    const windowRight = position.x + WINDOW_WIDTH
    const windowBottom = position.y + WINDOW_HEIGHT

    const isVisibleHorizontally = position.x < x + width && windowRight > x
    const isVisibleVertically = position.y < y + height && windowBottom > y

    if (isVisibleHorizontally && isVisibleVertically) {
      return true
    }
  }

  return false
}

function resetWindowPosition(saveToStore = true): void {
  if (!mainWindow) return

  const defaultPosition = getDefaultPosition()
  mainWindow.setPosition(defaultPosition.x, defaultPosition.y)
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  if (saveToStore) {
    store.set('windowPosition', defaultPosition)
  }
}

/**
 * Força o tamanho da janela para o tamanho original.
 * O Windows 11 pode escalar a janela quando há mudanças de DPI/display.
 */
function forceDesiredSize(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const [currentWidth, currentHeight] = mainWindow.getSize()

  if (currentWidth !== WINDOW_WIDTH || currentHeight !== WINDOW_HEIGHT) {
    logWindowEvent('forcing-size', {
      from: { width: currentWidth, height: currentHeight },
      to: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
    })
    mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
  }
}

/**
 * Força a janela para a posição e tamanho desejados.
 * No Windows 11, às vezes é necessário chamar setPosition múltiplas vezes
 * porque o sistema operacional tenta "ajudar" movendo a janela.
 * Também restaura o tamanho que pode ser alterado por mudanças de DPI.
 */
function forceDesiredPosition(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const desired = store.get('windowPosition') ?? DESIRED_POSITION
  const [currentX, currentY] = mainWindow.getPosition()
  const [currentWidth, currentHeight] = mainWindow.getSize()

  if (currentWidth !== WINDOW_WIDTH || currentHeight !== WINDOW_HEIGHT) {
    logWindowEvent('forcing-size', {
      from: { width: currentWidth, height: currentHeight },
      to: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
    })
    mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
  }

  if (currentX !== desired.x || currentY !== desired.y) {
    logWindowEvent('forcing-position', { from: { x: currentX, y: currentY }, to: desired })

    mainWindow.setPosition(desired.x, desired.y)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      forceDesiredSize()
      const [x1, y1] = mainWindow.getPosition()
      if (x1 !== desired.x || y1 !== desired.y) {
        logWindowEvent('forcing-position-retry-1', { current: { x: x1, y: y1 }, desired })
        mainWindow.setPosition(desired.x, desired.y)
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 100)

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      forceDesiredSize()
      const [x2, y2] = mainWindow.getPosition()
      if (x2 !== desired.x || y2 !== desired.y) {
        logWindowEvent('forcing-position-retry-2', { current: { x: x2, y: y2 }, desired })
        mainWindow.setPosition(desired.x, desired.y)
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 500)

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      forceDesiredSize()
      const [x3, y3] = mainWindow.getPosition()
      if (x3 !== desired.x || y3 !== desired.y) {
        logWindowEvent('forcing-position-retry-3', { current: { x: x3, y: y3 }, desired })
        mainWindow.setPosition(desired.x, desired.y)
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      } else {
        logWindowEvent('position-restored-successfully', { position: desired })
      }
    }, 1000)
  } else {
    logWindowEvent('position-already-correct', { position: desired })
  }
}

function createWindow(): void {
  const savedPosition = store.get('windowPosition')

  const finalPosition =
    savedPosition && isPositionVisible(savedPosition) ? savedPosition : getDefaultPosition()

  mainWindow = new BrowserWindow({
    title: 'Desktop Widget Clock',
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: finalPosition.x,
    y: finalPosition.y,
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
  logWindowEvent('Window created', {
    position: finalPosition,
    savedPosition,
    isPositionValid: isPositionVisible(finalPosition),
  })

  // ============================================
  // WINDOW EVENT LOGGING
  // ============================================
  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    logWindowEvent('ready-to-show', { x, y })
    mainWindow.show()

    const currentSavedPosition = store.get('windowPosition')
    if (!currentSavedPosition) {
      store.set('windowPosition', DESIRED_POSITION)
      logWindowEvent('initial-position-saved', { position: DESIRED_POSITION })
    }

    setTimeout(forceDesiredPosition, 100)
  })

  mainWindow.on('show', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    const [w, h] = mainWindow.getSize()
    logWindowEvent('show', {
      x,
      y,
      width: w,
      height: h,
      isVisible: mainWindow.isVisible(),
      isOnTop: mainWindow.isAlwaysOnTop(),
    })
  })

  mainWindow.on('hide', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    logWindowEvent('hide', { x, y })
  })

  mainWindow.on('minimize', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    logWindowEvent('minimize', { x, y })
  })

  mainWindow.on('restore', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    logWindowEvent('restore', { x, y })
  })

  mainWindow.on('focus', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    logWindowEvent('focus', { x, y })
  })

  mainWindow.on('blur', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    logWindowEvent('blur', { x, y })
  })

  mainWindow.on('moved', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    store.set('windowPosition', { x, y })
    logWindowEvent('moved', { x, y })
  })

  mainWindow.on('resize', () => {
    if (!mainWindow) return
    const [width, height] = mainWindow.getSize()
    logWindowEvent('resize', {
      width,
      height,
      expected: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
    })
    if (width !== WINDOW_WIDTH || height !== WINDOW_HEIGHT) {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        logWindowEvent('forcing-size-after-resize', {
          from: { width, height },
          to: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
        })
        mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
      }, 50)
    }
  })

  mainWindow.on('closed', () => {
    logWindowEvent('closed')
    mainWindow = null
  })

  mainWindow.on('unresponsive', () => {
    logWindowEvent('unresponsive', { warning: 'Window became unresponsive!' })
  })

  mainWindow.on('responsive', () => {
    logWindowEvent('responsive')
  })

  mainWindow.webContents.on('did-finish-load', () => {
    logWindowEvent('webContents:did-finish-load')
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logError('WINDOW', 'webContents:did-fail-load', { errorCode, errorDescription })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('WINDOW', 'webContents:render-process-gone', JSON.stringify(details))
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    logWindowEvent('webContents:window-open-handler', { url: details.url })
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

// ============================================
// STARTUP LOGGING
// ============================================
logAppEvent('App starting', {
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  argv: process.argv,
  execPath: process.execPath,
  cwd: process.cwd(),
  platform: process.platform,
  arch: process.arch,
})

if (process.platform === 'win32') {
  const squirrelCommand = process.argv[1]
  if (squirrelCommand) {
    const isSquirrelEvent = [
      '--squirrel-install',
      '--squirrel-updated',
      '--squirrel-uninstall',
      '--squirrel-obsolete',
      '--squirrel-firstrun',
    ].includes(squirrelCommand)

    if (isSquirrelEvent) {
      logAppEvent('Squirrel event detected, quitting', { command: squirrelCommand })
      app.quit()
    }
  }
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  logAppEvent('Another instance is running, quitting')
  app.quit()
} else {
  logAppEvent('Got single instance lock')
  app.on('second-instance', (_event, commandLine) => {
    logAppEvent('Second instance attempted', { commandLine })
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
  app.setLoginItemSettings({ openAtLogin, path: app.getPath('exe'), args: [] })

  ipcMain.on('ping', () => {
    console.log('pong', IPC.PING)
  })

  createTray()
  logAppEvent('Tray created')
  createWindow()

  // setInterval(() => {
  //   if (mainWindow) {
  //     const [x, y] = mainWindow.getPosition()
  //     const [w, h] = mainWindow.getSize()
  //     const isVisible = mainWindow.isVisible()
  //     const isMinimized = mainWindow.isMinimized()
  //     const isDestroyed = mainWindow.isDestroyed()
  //     const isOnTop = mainWindow.isAlwaysOnTop()

  //     logWindowEvent('periodic-check', {
  //       x,
  //       y,
  //       width: w,
  //       height: h,
  //       isVisible,
  //       isMinimized,
  //       isDestroyed,
  //       isPositionVisible: isPositionVisible({ x, y }),
  //       isOnTop,
  //     })

  //     const desired = store.get('windowPosition') ?? DESIRED_POSITION
  //     if (x !== desired.x || y !== desired.y) {
  //       logWindowEvent('periodic-position-correction', {
  //         current: { x, y },
  //         desired,
  //       })
  //       forceDesiredPosition()
  //     }

  //     if (!isVisible && !isMinimized && !isDestroyed) {
  //       logWindowEvent('auto-recover', { reason: 'Window was hidden unexpectedly' })
  //       mainWindow.show()
  //     }
  //   } else {
  //     logWindowEvent('periodic-check', { status: 'mainWindow is null' })
  //   }
  // }, 60000) // Check every minute

  screen.on('display-added', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    const [width, height] = mainWindow.getSize()
    logAppEvent('display-added', { currentPosition: { x, y }, currentSize: { width, height } })
    forceDesiredSize()
    setTimeout(forceDesiredPosition, 500)
    setTimeout(forceDesiredPosition, 1500)
    setTimeout(forceDesiredPosition, 3000)
  })

  screen.on('display-removed', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    const [width, height] = mainWindow.getSize()
    logAppEvent('display-removed', { currentPosition: { x, y }, currentSize: { width, height } })
    forceDesiredSize()
    setTimeout(forceDesiredPosition, 500)
    setTimeout(forceDesiredPosition, 1500)
    setTimeout(forceDesiredPosition, 3000)
  })

  screen.on('display-metrics-changed', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    const [width, height] = mainWindow.getSize()
    logAppEvent('display-metrics-changed', {
      currentPosition: { x, y },
      currentSize: { width, height },
    })
    forceDesiredSize()
    setTimeout(forceDesiredPosition, 500)
    setTimeout(forceDesiredPosition, 1500)
    setTimeout(forceDesiredPosition, 3000)
  })

  app.on('activate', () => {
    logAppEvent('activate')
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
  logError('PROCESS', 'uncaughtException', JSON.stringify(error))
})

process.on('unhandledRejection', (reason) => {
  logError('PROCESS', 'unhandledRejection', JSON.stringify(reason as Error))
})
