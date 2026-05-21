import { useEffect, useState } from 'react'
import { api } from '@/libs/api'
import type { BluetoothBatteryData, TemperatureData, TemperatureDisplayType } from '~/shared/types'

export function DigitalClock() {
  const [time, setTime] = useState(new Date())
  const [temperature, setTemperature] = useState<TemperatureData | null>(null)
  const [displayType, setDisplayType] = useState<TemperatureDisplayType>('temperatura')
  const [bluetoothBattery, setBluetoothBattery] = useState<BluetoothBatteryData | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    api.getTemperature().then(setTemperature)
    api.getTemperatureDisplay().then(setDisplayType)
    api.getBluetoothBattery().then(setBluetoothBattery)

    const unsubscribeTemp = api.onTemperatureUpdate((data) => {
      setTemperature(data)
    })

    const unsubscribeDisplay = api.onTemperatureDisplayChange((display) => {
      setDisplayType(display)
    })

    const unsubscribeBluetooth = api.onBluetoothBatteryUpdate((data) => {
      setBluetoothBattery(data)
    })

    return () => {
      unsubscribeTemp()
      unsubscribeDisplay()
      unsubscribeBluetooth()
    }
  }, [])

  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const seconds = time.getSeconds().toString().padStart(2, '0')

  const currentTemp =
    displayType === 'temperatura' ? temperature?.temperatura : temperature?.sensTermica

  const activeBattery = bluetoothBattery?.activeDevice?.batteryLevel

  const digitClass =
    'text-2xl font-semibold text-orange-600 tabular-nums tracking-wider antialiased font-[Cascadia_Code] text-shadow-lg'
  const colonClass = `${digitClass} animate-blink`
  const temperatureClass =
    'text-lg font-semibold text-white/70 tabular-nums tracking-tighter antialiased font-[Cascadia_Code] text-shadow-lg'
  const batteryClass =
    'text-lg font-semibold text-white/50 tabular-nums tracking-tighter antialiased font-[Cascadia_Code] text-shadow-lg'

  return (
    <div className="flex items-end justify-start w-full h-full gap-4 pl-4">
      <div>
        <span className={digitClass}>{hours}</span>
        <span className={colonClass}>:</span>
        <span className={digitClass}>{minutes}</span>
        <span className={colonClass}>:</span>
        <span className={digitClass}>{seconds}</span>
      </div>
      {currentTemp?.value && (
        <span className={temperatureClass}>
          {Number(currentTemp.value).toFixed(1).replace('.', ',')}º
        </span>
      )}
      {activeBattery !== null && activeBattery !== undefined && (
        <span className={batteryClass} title={bluetoothBattery?.activeDevice?.name}>
          🎧{activeBattery}%
        </span>
      )}
    </div>
  )
}
