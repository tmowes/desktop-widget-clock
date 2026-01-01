import Store from 'electron-store'

export interface WindowPosition {
  x: number
  y: number
}

export interface StoreSchema {
  windowPosition: WindowPosition | null
  openAtLogin: boolean
}

export const store = new Store<StoreSchema>({
  defaults: {
    windowPosition: null,
    openAtLogin: true,
  },
})
