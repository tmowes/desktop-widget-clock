import { ipcMain } from 'electron'
import { IPC } from '~/shared/ipc'
import { logAppEvent } from './logger'

export function setupIpcHandlers(): void {
  ipcMain.on('ping', () => {
    logAppEvent('IPC ping received')
    console.log('pong', IPC.PING)
  })
}
