import { useEffect, useState } from 'react'
import { api } from '@/libs/api'

type TemperatureDisplayType = 'temperatura' | 'sensTermica'

interface TemperatureData {
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

export function DigitalClock() {
  const [time, setTime] = useState(new Date())
  const [temperature, setTemperature] = useState<TemperatureData | null>(null)
  const [displayType, setDisplayType] = useState<TemperatureDisplayType>('temperatura')

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    api.getTemperature().then(setTemperature)
    api.getTemperatureDisplay().then(setDisplayType)

    const unsubscribeTemp = api.onTemperatureUpdate((data) => {
      setTemperature(data)
    })

    const unsubscribeDisplay = api.onTemperatureDisplayChange((display) => {
      setDisplayType(display)
    })

    return () => {
      unsubscribeTemp()
      unsubscribeDisplay()
    }
  }, [])

  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const seconds = time.getSeconds().toString().padStart(2, '0')

  const currentTemp =
    displayType === 'temperatura' ? temperature?.temperatura : temperature?.sensTermica

  const digitClass =
    'text-2xl font-semibold text-orange-600 tabular-nums tracking-wider antialiased font-[Cascadia_Code] text-shadow-lg'
  const colonClass = `${digitClass} animate-blink`
  const temperatureClass =
    'text-lg font-semibold text-white/70 tabular-nums tracking-tighter antialiased font-[Cascadia_Code] text-shadow-lg'

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
    </div>
  )
}
