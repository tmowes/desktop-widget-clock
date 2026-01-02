import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import Store from 'electron-store'
import { logAppEvent, logError, logWindowEvent, type WindowState } from './logger'
import type { StoreSchema, WindowPosition } from './store'

export const WINDOW_WIDTH = 320
export const WINDOW_HEIGHT = 47
export const DESIRED_POSITION: WindowPosition = { x: 0, y: 1696 }

let mainWindow: BrowserWindow | null = null

function getWindowState(): WindowState | undefined {
  if (!mainWindow || mainWindow.isDestroyed()) return undefined
  const [x, y] = mainWindow.getPosition()
  const [width, height] = mainWindow.getSize()
  const isOnTop = mainWindow.isAlwaysOnTop()
  return { x, y, width, height, isOnTop }
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function getDefaultPosition(): WindowPosition {
  return DESIRED_POSITION
}

export function isPositionVisible(position: WindowPosition): boolean {
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

export function resetWindowPosition(store: Store<StoreSchema>, saveToStore = true): void {
  if (!mainWindow) return

  const defaultPosition = getDefaultPosition()
  mainWindow.setPosition(defaultPosition.x, defaultPosition.y)
  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  if (saveToStore) {
    store.set('windowPosition', defaultPosition)
  }

  const state = getWindowState()
  logWindowEvent('reset-window-position', { saveToStore }, state)
}

/**
 * Força o tamanho da janela para o tamanho original.
 * O Windows 11 pode escalar a janela quando há mudanças de DPI/display.
 */
export function forceDesiredSize(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const [currentWidth, currentHeight] = mainWindow.getSize()

  if (currentWidth !== WINDOW_WIDTH || currentHeight !== WINDOW_HEIGHT) {
    const state = getWindowState()
    logWindowEvent(
      'forcing-size',
      {
        from: { width: currentWidth, height: currentHeight },
        to: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
      },
      state,
    )
    mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
  }
}

/**
 * Força a janela para a posição e tamanho desejados.
 * No Windows 11, às vezes é necessário chamar setPosition múltiplas vezes
 * porque o sistema operacional tenta "ajudar" movendo a janela.
 * Também restaura o tamanho que pode ser alterado por mudanças de DPI.
 */
export function forceDesiredPosition(store: Store<StoreSchema>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const desired = store.get('windowPosition') ?? DESIRED_POSITION
  const [currentX, currentY] = mainWindow.getPosition()
  const [currentWidth, currentHeight] = mainWindow.getSize()
  const state = getWindowState()

  if (currentWidth !== WINDOW_WIDTH || currentHeight !== WINDOW_HEIGHT) {
    logWindowEvent(
      'forcing-size',
      {
        from: { width: currentWidth, height: currentHeight },
        to: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
      },
      state,
    )
    mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
  }

  if (currentX !== desired.x || currentY !== desired.y) {
    logWindowEvent('forcing-position', { from: { x: currentX, y: currentY }, to: desired }, state)

    mainWindow.setPosition(desired.x, desired.y)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      forceDesiredSize()
      const [x1, y1] = mainWindow.getPosition()
      if (x1 !== desired.x || y1 !== desired.y) {
        const retryState = getWindowState()
        logWindowEvent(
          'forcing-position-retry-1',
          { current: { x: x1, y: y1 }, desired },
          retryState,
        )
        mainWindow.setPosition(desired.x, desired.y)
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 100)

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      forceDesiredSize()
      const [x2, y2] = mainWindow.getPosition()
      if (x2 !== desired.x || y2 !== desired.y) {
        const retryState = getWindowState()
        logWindowEvent(
          'forcing-position-retry-2',
          { current: { x: x2, y: y2 }, desired },
          retryState,
        )
        mainWindow.setPosition(desired.x, desired.y)
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 500)

    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      forceDesiredSize()
      const [x3, y3] = mainWindow.getPosition()
      const finalState = getWindowState()
      if (x3 !== desired.x || y3 !== desired.y) {
        logWindowEvent(
          'forcing-position-retry-3',
          { current: { x: x3, y: y3 }, desired },
          finalState,
        )
        mainWindow.setPosition(desired.x, desired.y)
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
      } else {
        logWindowEvent('position-restored-successfully', undefined, finalState)
      }
    }, 1000)
  } else {
    logWindowEvent('position-already-correct', undefined, state)
  }
}

export function createWindow(store: Store<StoreSchema>): BrowserWindow {
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

  const state = getWindowState()
  logWindowEvent(
    'Window created',
    {
      savedPosition,
      isPositionValid: isPositionVisible(finalPosition),
    },
    state,
  )

  setupWindowEvents(store)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function setupWindowEvents(store: Store<StoreSchema>): void {
  if (!mainWindow) return

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('ready-to-show', undefined, state)
    mainWindow.show()

    const currentSavedPosition = store.get('windowPosition')
    if (!currentSavedPosition) {
      store.set('windowPosition', DESIRED_POSITION)
      logWindowEvent('initial-position-saved', undefined, state)
    }

    setTimeout(() => forceDesiredPosition(store), 100)
  })

  mainWindow.on('show', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('show', { isVisible: mainWindow.isVisible() }, state)
  })

  mainWindow.on('hide', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('hide', undefined, state)
  })

  mainWindow.on('minimize', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('minimize', undefined, state)
  })

  mainWindow.on('restore', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('restore', undefined, state)
  })

  mainWindow.on('focus', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('focus', undefined, state)
  })

  mainWindow.on('blur', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logWindowEvent('blur', undefined, state)
  })

  mainWindow.on('moved', () => {
    if (!mainWindow) return
    const [x, y] = mainWindow.getPosition()
    store.set('windowPosition', { x, y })
    const state = getWindowState()
    logWindowEvent('moved', undefined, state)
  })

  mainWindow.on('resize', () => {
    if (!mainWindow) return
    const [width, height] = mainWindow.getSize()
    const state = getWindowState()
    logWindowEvent('resize', { expected: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT } }, state)
    if (width !== WINDOW_WIDTH || height !== WINDOW_HEIGHT) {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const resizeState = getWindowState()
        logWindowEvent(
          'forcing-size-after-resize',
          {
            from: { width, height },
            to: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
          },
          resizeState,
        )
        mainWindow.setSize(WINDOW_WIDTH, WINDOW_HEIGHT)
      }, 50)
    }
  })

  mainWindow.on('closed', () => {
    logWindowEvent('closed')
    mainWindow = null
  })

  mainWindow.on('unresponsive', () => {
    const state = getWindowState()
    logWindowEvent('unresponsive', { warning: 'Window became unresponsive!' }, state)
  })

  mainWindow.on('responsive', () => {
    const state = getWindowState()
    logWindowEvent('responsive', undefined, state)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    const state = getWindowState()
    logWindowEvent('webContents:did-finish-load', undefined, state)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logError('WINDOW', 'webContents:did-fail-load', { errorCode, errorDescription })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('WINDOW', 'webContents:render-process-gone', JSON.stringify(details))
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const state = getWindowState()
    logWindowEvent('webContents:window-open-handler', { url: details.url }, state)
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
}

export function setupDisplayEvents(store: Store<StoreSchema>): void {
  screen.on('display-added', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logAppEvent('display-added', {
      position: state ? { x: state.x, y: state.y } : undefined,
      size: state ? { width: state.width, height: state.height } : undefined,
      isOnTop: state?.isOnTop,
    })
    forceDesiredSize()
    setTimeout(() => forceDesiredPosition(store), 500)
    setTimeout(() => forceDesiredPosition(store), 1500)
    setTimeout(() => forceDesiredPosition(store), 3000)
  })

  screen.on('display-removed', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logAppEvent('display-removed', {
      position: state ? { x: state.x, y: state.y } : undefined,
      size: state ? { width: state.width, height: state.height } : undefined,
      isOnTop: state?.isOnTop,
    })
    forceDesiredSize()
    setTimeout(() => forceDesiredPosition(store), 500)
    setTimeout(() => forceDesiredPosition(store), 1500)
    setTimeout(() => forceDesiredPosition(store), 3000)
  })

  screen.on('display-metrics-changed', () => {
    if (!mainWindow) return
    const state = getWindowState()
    logAppEvent('display-metrics-changed', {
      position: state ? { x: state.x, y: state.y } : undefined,
      size: state ? { width: state.width, height: state.height } : undefined,
      isOnTop: state?.isOnTop,
    })
    forceDesiredSize()
    setTimeout(() => forceDesiredPosition(store), 500)
    setTimeout(() => forceDesiredPosition(store), 1500)
    setTimeout(() => forceDesiredPosition(store), 3000)
  })
}
