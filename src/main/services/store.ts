import Store from 'electron-store'

export interface WindowPosition {
  x: number
  y: number
}

export type TemperatureDisplayType = 'temperatura' | 'sensTermica'

export interface StoreSchema {
  windowPosition: WindowPosition | null
  openAtLogin: boolean
  temperatureDisplay: TemperatureDisplayType
}

export const store = new Store<StoreSchema>({
  defaults: {
    windowPosition: null,
    openAtLogin: true,
    temperatureDisplay: 'temperatura',
  },
})
