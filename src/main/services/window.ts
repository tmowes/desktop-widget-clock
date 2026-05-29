import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import Store from 'electron-store'
import type { StoreSchema, WindowPosition, WindowState } from '~/shared/types'
import { logAppEvent, logError, logWindowEvent } from './logger'

export const WINDOW_WIDTH = 320
export const WINDOW_HEIGHT = 32

const OVERLAY_RECOVERY_DELAYS_MS = [0, 250, 1000, 2500]

let mainWindow: BrowserWindow | null = null
const overlayRecoveryTimeouts = new Set<NodeJS.Timeout>()

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

/**
 * Posição padrão do widget: encostado no canto inferior esquerdo do monitor
 * principal.
 *
 * O Electron posiciona janelas em pixels lógicos (DIP), então derivamos a
 * posição a partir de `bounds` do display principal em vez de usar um valor
 * fixo. Assim a janela fica alinhada à base em qualquer escala do Windows
 * (o valor não precisa ser multiplicado pela escala):
 *   - 100%: bounds.height = 2160 -> y = 2160 - 32 = 2128
 *   - 125%: bounds.height = 1728 -> y = 1728 - 32 = 1696 (antigo valor fixo)
 */
function getDefaultPosition(): WindowPosition {
  const { bounds } = screen.getPrimaryDisplay()
  return {
    x: bounds.x,
    y: bounds.y + bounds.height - WINDOW_HEIGHT,
  }
}

/**
 * Resolve a âncora correta da janela (canto inferior esquerdo do monitor
 * principal) para a escala/layout de telas atuais e mantém o valor salvo em
 * sincronia.
 *
 * Como o widget é um overlay fixo (não arrastável), a posição salva é apenas um
 * cache. Se a escala do Windows mudar — na inicialização ou em tempo real, de
 * 100% a 300% — o valor salvo fica obsoleto, então recalculamos a partir de
 * `bounds` (em DIP) do monitor principal e fazemos a janela "grudar" na base
 * novamente.
 */
function resolveAnchoredPosition(store: Store<StoreSchema>): WindowPosition {
  const anchor = getDefaultPosition()
  const saved = store.get('windowPosition')

  if (!saved || saved.x !== anchor.x || saved.y !== anchor.y) {
    store.set('windowPosition', anchor)
    if (saved) {
      logWindowEvent('re-anchored-position', { from: saved, to: anchor })
    }
  }

  return anchor
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

  const desired = resolveAnchoredPosition(store)
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

  // Revalida a posição salva contra a base do monitor atual: se a escala do
  // Windows mudou enquanto o app estava fechado, reposiciona automaticamente
  // (sem necessidade de reset manual).
  const finalPosition = resolveAnchoredPosition(store)

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

function runOverlayRecovery(store: Store<StoreSchema>, reason: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setIgnoreMouseEvents(true, { forward: true })

  forceDesiredSize()
  forceDesiredPosition(store)

  const state = getWindowState()
  logWindowEvent('overlay-recovery-pass', { reason }, state)
}

export function scheduleOverlayRecovery(store: Store<StoreSchema>, reason: string): void {
  const state = getWindowState()
  logWindowEvent(
    'overlay-recovery-scheduled',
    { reason, delays: OVERLAY_RECOVERY_DELAYS_MS },
    state,
  )

  for (const delayMs of OVERLAY_RECOVERY_DELAYS_MS) {
    const timeout = setTimeout(() => {
      overlayRecoveryTimeouts.delete(timeout)
      runOverlayRecovery(store, `${reason}+${delayMs}ms`)
    }, delayMs)
    overlayRecoveryTimeouts.add(timeout)
  }
}

export function cancelPendingOverlayRecoveries(): void {
  for (const timeout of overlayRecoveryTimeouts) {
    clearTimeout(timeout)
  }
  overlayRecoveryTimeouts.clear()
}

export function setupDisplayEvents(store: Store<StoreSchema>): void {
  const handleDisplayEvent = (event: string, details?: Record<string, unknown>) => {
    if (!mainWindow) return
    const state = getWindowState()
    logAppEvent(event, {
      ...details,
      position: state ? { x: state.x, y: state.y } : undefined,
      size: state ? { width: state.width, height: state.height } : undefined,
      isOnTop: state?.isOnTop,
    })
    scheduleOverlayRecovery(store, event)
  }

  screen.on('display-added', () => handleDisplayEvent('display-added'))
  screen.on('display-removed', () => handleDisplayEvent('display-removed'))
  // Mudanças de escala/DPI do Windows chegam aqui com 'scaleFactor' em
  // changedMetrics. A recuperação recalcula a âncora para a nova escala, então a
  // janela volta a grudar na base dinamicamente (100%–300%).
  screen.on('display-metrics-changed', (_event, display, changedMetrics) => {
    handleDisplayEvent('display-metrics-changed', {
      displayId: display.id,
      scaleFactor: display.scaleFactor,
      changedMetrics,
    })
  })
}