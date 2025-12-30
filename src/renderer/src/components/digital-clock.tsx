import { useEffect, useState } from 'react'

export function DigitalClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const hours = time.getHours().toString().padStart(2, '0')
  const minutes = time.getMinutes().toString().padStart(2, '0')
  const seconds = time.getSeconds().toString().padStart(2, '0')

  const digitClass =
    'text-2xl font-semibold text-orange-600 tabular-nums tracking-wider antialiased font-[Cascadia_Code] text-shadow-lg'
  const colonClass = `${digitClass} animate-blink`

  return (
    <div className="flex items-center justify-center w-full h-full">
      <span className={digitClass}>{hours}</span>
      <span className={colonClass}>:</span>
      <span className={digitClass}>{minutes}</span>
      <span className={colonClass}>:</span>
      <span className={digitClass}>{seconds}</span>
    </div>
  )
}
