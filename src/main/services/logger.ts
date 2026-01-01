import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'

const LOG_DIR = join(app.getPath('userData'), 'logs')
const LOG_FILE = join(LOG_DIR, 'window-events.log')
const MAX_LOG_SIZE = 1024 * 1024 // 1MB

export function getLogDir(): string {
  return LOG_DIR
}

export function getLogFile(): string {
  return LOG_FILE
}

export function openLogsFolder(): void {
  ensureLogDirectory()
  shell.openPath(LOG_DIR)
}

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

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isOnTop: boolean
}

export function log(
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

export function logWindowEvent(
  event: string,
  data?: Record<string, unknown>,
  windowState?: WindowState,
): void {
  const logData: Record<string, unknown> = { ...data }

  if (windowState) {
    logData.position = { x: windowState.x, y: windowState.y }
    logData.size = { width: windowState.width, height: windowState.height }
    logData.isOnTop = windowState.isOnTop
  }

  log('INFO', 'WINDOW', event, Object.keys(logData).length > 0 ? logData : undefined)
}

export function logAppEvent(event: string, data?: Record<string, unknown>): void {
  log('INFO', 'APP', event, data)
}

export function logError(category: string, message: string, error?: unknown): void {
  const errorData =
    error instanceof Error ? { error: error.message, stack: error.stack } : { error: String(error) }
  log('ERROR', category, message, errorData)
}
