import Store from 'electron-store'
import type { StoreSchema } from '~/shared/types'

export const store = new Store<StoreSchema>({
  defaults: {
    windowPosition: null,
    openAtLogin: true,
    temperatureDisplay: 'temperatura',
  },
})
