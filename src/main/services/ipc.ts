import { ipcMain } from 'electron'
import { IPC } from '~/shared/ipc'
import { getLastBluetoothBatteryData } from './bluetooth-battery'
import { logAppEvent } from './logger'
import { store } from './store'
import { getLastTemperatureData } from './temperature'

export function setupIpcHandlers(): void {
  ipcMain.on('ping', () => {
    logAppEvent('IPC ping received')
    console.log('pong', IPC.PING)
  })

  ipcMain.handle(IPC.GET_TEMPERATURE, () => {
    return getLastTemperatureData()
  })

  ipcMain.handle(IPC.GET_TEMPERATURE_DISPLAY, () => {
    return store.get('temperatureDisplay')
  })

  ipcMain.handle(IPC.GET_BLUETOOTH_BATTERY, () => {
    return getLastBluetoothBatteryData()
  })
}
