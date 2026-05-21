export type TemperatureDisplayType = 'temperatura' | 'sensTermica'

export type TemperatureReading = {
  value: string | null
  unit: string | null
  label: string | null
}

export type TemperatureData = {
  sensTermica: TemperatureReading
  temperatura: TemperatureReading
  timestamp: string
}

export type BluetoothDevice = {
  name: string
  batteryLevel: number | null
  isActive: boolean
}

export type BluetoothBatteryData = {
  devices: BluetoothDevice[]
  activeDevice: BluetoothDevice | null
  timestamp: string
}

export type WindowPosition = {
  x: number
  y: number
}

export type WindowState = {
  x: number
  y: number
  width: number
  height: number
  isOnTop: boolean
}

export type StoreSchema = {
  windowPosition: WindowPosition | null
  openAtLogin: boolean
  temperatureDisplay: TemperatureDisplayType
}
