import { contextBridge, IpcRendererEvent, ipcRenderer } from 'electron'

export type TemperatureDisplayType = 'temperatura' | 'sensTermica'

export interface TemperatureData {
  sensTermica: {
    value: string | null
    unit: string | null
    label: string | null
  }
  temperatura: {
    value: string | null
    unit: string | null
    label: string | null
  }
  timestamp: string
}

const api = {
  ping: (): void => {
    ipcRenderer.send('ping')
  },
  process: () => ({
    versions: process.versions,
  }),
  getTemperature: (): Promise<TemperatureData | null> => {
    return ipcRenderer.invoke('get-temperature')
  },
  onTemperatureUpdate: (callback: (data: TemperatureData) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: TemperatureData): void => {
      callback(data)
    }
    ipcRenderer.on('temperature-update', handler)
    return () => {
      ipcRenderer.removeListener('temperature-update', handler)
    }
  },
  getTemperatureDisplay: (): Promise<TemperatureDisplayType> => {
    return ipcRenderer.invoke('get-temperature-display')
  },
  onTemperatureDisplayChange: (
    callback: (display: TemperatureDisplayType) => void,
  ): (() => void) => {
    const handler = (_event: IpcRendererEvent, display: TemperatureDisplayType): void => {
      callback(display)
    }
    ipcRenderer.on('temperature-display-change', handler)
    return () => {
      ipcRenderer.removeListener('temperature-display-change', handler)
    }
  },
}

declare global {
  interface Window {
    api: typeof api
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
