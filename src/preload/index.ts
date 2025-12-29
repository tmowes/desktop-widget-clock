import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ping: (): void => {
    ipcRenderer.send('ping')
  },
  process: () => ({
    versions: process.versions,
  }),
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
