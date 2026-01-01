import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { logAppEvent, logError } from './logger'
import { getMainWindow } from './window'

const LOG_DIR = join(app.getPath('userData'), 'logs')
const TEMPERATURE_LOG_FILE = join(LOG_DIR, 'temperature.log')
const ESTACAO = 'DCSC-00034'
const API_URL = 'https://monitoramento.defesacivil.sc.gov.br/graphql'
const FETCH_INTERVAL = 15_000 // 15 seconds

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

let intervalId: ReturnType<typeof setInterval> | null = null
let lastTemperatureData: TemperatureData | null = null

function ensureLogDirectory(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function formatValue(value: string | null): string {
  if (value === null) return 'N/A'
  const num = Number.parseFloat(value)
  return Number.isNaN(num) ? value : num.toFixed(2)
}

function logTemperature(data: TemperatureData): void {
  ensureLogDirectory()
  const sensTermica = formatValue(data.sensTermica.value)
  const temperatura = formatValue(data.temperatura.value)
  const logLine = `[${data.timestamp}] ${ESTACAO} | Sensação Térmica: ${sensTermica}${data.sensTermica.unit} | Temperatura: ${temperatura}${data.temperatura.unit}\n`
  appendFileSync(TEMPERATURE_LOG_FILE, logLine)
}

async function fetchTemperatureData(): Promise<TemperatureData | null> {
  try {
    const payload = {
      operationName: 'Teste',
      variables: {},
      query: 'query Teste {\n  tags: estacao_getEstacao(codigos: [])\n}',
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const json = await response.json()
    const estacaoData = json?.data?.tags?.[ESTACAO]

    if (!estacaoData) {
      logError('Temperature fetch', `No data found for station ${ESTACAO}`)
      return null
    }

    const data: TemperatureData = {
      sensTermica: {
        value: estacaoData['Data/SensTermica/Atual/Value'] ?? null,
        unit: estacaoData['Data/SensTermica/Atual/Unit'] ?? null,
        label: estacaoData['Data/SensTermica/Atual/Label'] ?? null,
      },
      temperatura: {
        value: estacaoData['Data/Temperatura/Atual/Value'] ?? null,
        unit: estacaoData['Data/Temperatura/Atual/Unit'] ?? null,
        label: estacaoData['Data/Temperatura/Atual/Label'] ?? null,
      },
      timestamp: new Date().toISOString(),
    }

    return data
  } catch (error) {
    logError('Temperature fetch', 'Failed to fetch temperature data', error)
    return null
  }
}

async function fetchAndLogTemperature(): Promise<void> {
  const data = await fetchTemperatureData()
  if (data) {
    lastTemperatureData = data
    logTemperature(data)
    logAppEvent('Temperature fetched', {
      sensTermica: `${data.sensTermica.value}${data.sensTermica.unit}`,
      temperatura: `${data.temperatura.value}${data.temperatura.unit}`,
    })

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('temperature-update', data)
    }
  }
}

export function startTemperatureService(): void {
  if (intervalId) {
    logAppEvent('Temperature service already running')
    return
  }

  logAppEvent('Starting temperature service', {
    estacao: ESTACAO,
    interval: `${FETCH_INTERVAL / 1000}s`,
  })

  fetchAndLogTemperature()

  intervalId = setInterval(fetchAndLogTemperature, FETCH_INTERVAL)
}

export function stopTemperatureService(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    logAppEvent('Temperature service stopped')
  }
}

export function getLastTemperatureData(): TemperatureData | null {
  return lastTemperatureData
}
