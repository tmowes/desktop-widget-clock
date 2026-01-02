import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { logAppEvent, logError } from './logger'
import { getMainWindow } from './window'

const execAsync = promisify(exec)

const FETCH_INTERVAL = 30_000 // 30 seconds

export interface BluetoothDevice {
  name: string
  batteryLevel: number | null
  isActive: boolean
}

export interface BluetoothBatteryData {
  devices: BluetoothDevice[]
  activeDevice: BluetoothDevice | null
  timestamp: string
}

let intervalId: ReturnType<typeof setInterval> | null = null
let lastBluetoothData: BluetoothBatteryData | null = null

/**
 * Encodes a PowerShell script to Base64 for safe execution
 */
function encodePS(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * Uses PowerShell to query Windows for Bluetooth device battery levels
 * Only returns the active audio device (default playback device)
 */
async function fetchBluetoothBatteryData(): Promise<BluetoothBatteryData | null> {
  try {
    // PowerShell script that finds the active audio device and its battery
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# Bluetooth battery level property key
$batteryKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$containerIdKey = 'DEVPKEY_Device_ContainerId'

# Get active AudioEndpoints (both regular and Hands-Free) with Status OK
$activeEndpoints = Get-PnpDevice -Class AudioEndpoint -Status OK | Where-Object {
  $_.FriendlyName -match 'Fones de ouvido|Headphones|Headset|TMoweS'
}

# Build a set of active ContainerIds - single property fetch per endpoint
$activeContainerIds = @{}
foreach ($ep in $activeEndpoints) {
  $allProps = Get-PnpDeviceProperty -InstanceId $ep.InstanceId -ErrorAction SilentlyContinue
  $containerProp = $allProps | Where-Object { $_.KeyName -eq $containerIdKey }
  if ($containerProp -and $containerProp.Data) {
    $activeContainerIds[$containerProp.Data.ToString()] = $true
  }
}

# Search for Bluetooth devices with battery potential
$devices = Get-PnpDevice -Status OK | Where-Object {
  $_.FriendlyName -match 'Buds|WH-|Headphone|Headset|AirPods|Earphone|Hands-Free|Galaxy|Sony|JBL|Bose|Jabra|PX7|Momentum' -and
  $_.FriendlyName -notmatch 'Transporte|Enumerator|Controller|Adapter'
}

# For each device, fetch ALL properties once and extract what we need
$deviceBatteries = @{}
foreach ($dev in $devices) {
  # Single call to get all properties for this device
  $allProps = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -ErrorAction SilentlyContinue

  # Extract battery level from cached properties
  $battProp = $allProps | Where-Object { $_.KeyName -eq $batteryKey }
  if ($battProp -and $null -ne $battProp.Data) {
    $battLevel = [int]$battProp.Data
    if ($battLevel -ge 0 -and $battLevel -le 100) {
      $cleanName = $dev.FriendlyName -replace ' Hands-Free.*$', ''

      # Extract ContainerId from cached properties
      $containerProp = $allProps | Where-Object { $_.KeyName -eq $containerIdKey }
      $containerId = if ($containerProp -and $containerProp.Data) { $containerProp.Data.ToString() } else { '' }

      # Check if this device's container is active
      $isActive = $containerId -and $activeContainerIds.ContainsKey($containerId)

      # Store by InstanceId to handle duplicates
      $deviceBatteries[$dev.InstanceId] = [PSCustomObject]@{
        Name = $cleanName
        BatteryLevel = $battLevel
        IsActive = $isActive
      }
    }
  }
}

# Group by name, preferring active devices
$grouped = @{}
foreach ($item in $deviceBatteries.Values) {
  $name = $item.Name
  if ($item.IsActive -or (-not $grouped[$name])) {
    $grouped[$name] = $item
  }
}

# Direct assignment instead of ForEach-Object pipeline
$results = @($grouped.Values)

if ($results.Count -eq 0) {
  Write-Output '[]'
} else {
  $results | ConvertTo-Json -Compress
}
`

    logAppEvent('Bluetooth: Fetching battery data...')
    const encoded = encodePS(psScript)

    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      {
        encoding: 'utf8',
        timeout: 20000,
        windowsHide: true,
      },
    )

    if (stderr && !stderr.includes('CLIXML') && !stderr.includes('progress')) {
      logError('Bluetooth', 'PowerShell stderr', stderr.substring(0, 500))
    }

    const trimmed = stdout.trim()
    logAppEvent(`Bluetooth: Raw output: ${trimmed.substring(0, 300)}`)

    if (!trimmed || trimmed === 'null' || trimmed === '' || trimmed === '[]') {
      logAppEvent('Bluetooth: No devices with battery found')
      return { devices: [], activeDevice: null, timestamp: new Date().toISOString() }
    }

    // biome-ignore lint/suspicious/noExplicitAny: PowerShell output parsing
    let parsedDevices: any[] = []
    try {
      const parsed = JSON.parse(trimmed)
      parsedDevices = Array.isArray(parsed) ? parsed : [parsed]
    } catch (parseError) {
      logError('Bluetooth', 'Failed to parse JSON', {
        output: trimmed.substring(0, 300),
        error: String(parseError),
      })
      return null
    }

    const devices: BluetoothDevice[] = parsedDevices
      .filter((d) => d && d.Name && typeof d.BatteryLevel === 'number')
      .map((d) => ({
        name: d.Name,
        batteryLevel: d.BatteryLevel,
        isActive: Boolean(d.IsActive),
      }))

    logAppEvent(`Bluetooth: Found ${devices.length} device(s) with battery`)
    devices.forEach((d) =>
      logAppEvent(`  - ${d.name}: ${d.batteryLevel}%${d.isActive ? ' [ACTIVE]' : ''}`),
    )

    const activeDevice = devices.find((d) => d.isActive && d.batteryLevel !== null) || null

    return {
      devices,
      activeDevice,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logError('Bluetooth', 'Failed to fetch battery data', errMsg.substring(0, 500))
    return null
  }
}

async function fetchAndUpdateBluetoothBattery(): Promise<void> {
  const data = await fetchBluetoothBatteryData()

  if (data) {
    lastBluetoothData = data

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bluetooth-battery-update', data)
    }
  }
}

export function startBluetoothBatteryMonitoring(): void {
  logAppEvent('Starting Bluetooth battery monitoring...')

  fetchAndUpdateBluetoothBattery()

  if (intervalId) {
    clearInterval(intervalId)
  }

  intervalId = setInterval(fetchAndUpdateBluetoothBattery, FETCH_INTERVAL)
  logAppEvent('Bluetooth battery monitoring started')
}

export function stopBluetoothBatteryMonitoring(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    logAppEvent('Bluetooth battery monitoring stopped')
  }
}

export function getLastBluetoothBatteryData(): BluetoothBatteryData | null {
  return lastBluetoothData
}
