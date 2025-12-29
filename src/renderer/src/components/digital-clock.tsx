import { useEffect, useState } from 'react'

export function DigitalClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = (date: Date): string => {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }

  return (
    <div className="flex items-center justify-center w-full h-full">
      <span className="text-2xl font-semibold text-orange-600 tabular-nums tracking-wider antialiased font-[Cascadia_Code] text-shadow-lg">
        {formatTime(time)}
      </span>
    </div>
  )
}
