import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { TemperatureData } from '~/shared/types'
import { logAppEvent, logError } from './logger'
import { getMainWindow } from './window'

const LOG_DIR = join(app.getPath('userData'), 'logs')
const TEMPERATURE_LOG_FILE = join(LOG_DIR, 'temperature.log')
const ESTACAO = 'DCSC-00034'
const WS_URL = 'wss://monitoramento-dcsc.quallecontrol.com.br/graphql'
const SUBSCRIPTION_QUERY = `subscription {
  nowcasting_unique(clients: ["secretaria-de-defesa-civil"], station: ["${ESTACAO}"]) {
    qualle_meteorologia {
      codigo
      timestamp
      data {
        temperatura { atual { value unit { value } } }
        senstermica { atual { value unit { value } } }
      }
    }
  }
}`
const RECONNECT_DELAY = 5_000

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let lastTemperatureData: TemperatureData | null = null
let running = false

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

type AtualValue = {
  value: number | null
  unit: { value: string | null } | null
}

type QualleMeteorologia = {
  codigo: string
  timestamp: string
  data: {
    temperatura: { atual: AtualValue | null } | null
    senstermica: { atual: AtualValue | null } | null
  } | null
}

type NowcastingPayload = {
  nowcasting_unique: { qualle_meteorologia: QualleMeteorologia | null } | null
}

type WsMessage = {
  id?: string
  type: 'connection_ack' | 'next' | 'error' | 'complete' | 'ping' | 'pong'
  payload?: { data?: NowcastingPayload; errors?: unknown }
}

function handleMessage(payload: NowcastingPayload | undefined): void {
  const estacao = payload?.nowcasting_unique?.qualle_meteorologia
  if (!estacao) return

  const temperaturaAtual = estacao.data?.temperatura?.atual
  const sensTermicaAtual = estacao.data?.senstermica?.atual

  const data: TemperatureData = {
    sensTermica: {
      value: sensTermicaAtual?.value != null ? String(sensTermicaAtual.value) : null,
      unit: sensTermicaAtual?.unit?.value ?? null,
      label: null,
    },
    temperatura: {
      value: temperaturaAtual?.value != null ? String(temperaturaAtual.value) : null,
      unit: temperaturaAtual?.unit?.value ?? null,
      label: null,
    },
    timestamp: estacao.timestamp ?? new Date().toISOString(),
  }

  lastTemperatureData = data
  logTemperature(data)

  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('temperature-update', data)
  }
}

function connect(): void {
  if (!running) return

  ws = new WebSocket(WS_URL, ['graphql-transport-ws'])
  let subscribed = false

  ws.onopen = () => {
    ws!.send(JSON.stringify({ type: 'connection_init', payload: {} }))
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage

      if (msg.type === 'connection_ack' && !subscribed) {
        subscribed = true
        ws!.send(
          JSON.stringify({
            id: '1',
            type: 'subscribe',
            payload: { query: SUBSCRIPTION_QUERY, variables: {} },
          }),
        )
      } else if (msg.type === 'next' && msg.id === '1') {
        handleMessage(msg.payload?.data)
      } else if (msg.type === 'error') {
        logError('Temperature WS', 'Subscription error', msg.payload)
      }
    } catch (error) {
      logError('Temperature WS', 'Failed to parse message', error)
    }
  }

  ws.onerror = () => {
    logError('Temperature WS', 'WebSocket connection error')
  }

  ws.onclose = () => {
    ws = null
    subscribed = false
    if (running) {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY)
    }
  }
}

export function startTemperatureService(): void {
  if (running) {
    logAppEvent('Temperature service already running')
    return
  }

  running = true
  logAppEvent('Starting temperature service', { estacao: ESTACAO, endpoint: WS_URL })
  connect()
}

export function stopTemperatureService(): void {
  running = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
  logAppEvent('Temperature service stopped')
}

export function getLastTemperatureData(): TemperatureData | null {
  return lastTemperatureData
}
