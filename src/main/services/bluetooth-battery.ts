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
 * OPTIMIZED VERSION - Fetch Bluetooth battery data using PowerShell
 * Key optimizations:
 * 1. Uses `-Class System` to drastically reduce initial device list
 * 2. Filters by `BTHENUM*` in InstanceId (real Bluetooth devices only)
 * 3. Filters by `Hands-Free` in name (only devices that report battery)
 */
async function fetchBluetoothBatteryData(): Promise<BluetoothBatteryData | null> {
  try {
    const psScript = `$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue'
$bk='{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2';$ck='DEVPKEY_Device_ContainerId'
$ae=Get-PnpDevice -Class AudioEndpoint -Status OK|?{$_.FriendlyName-match'Fones de ouvido|Headphones|Headset|TMoweS'}
$ac=@{};foreach($ep in $ae){$c=(Get-PnpDeviceProperty -InstanceId $ep.InstanceId -KeyName $ck -EA 0).Data;if($c){$ac[$c.ToString()]=$true}}
$d=Get-PnpDevice -Class System -Status OK|?{$_.InstanceId-like'BTHENUM*'-and$_.FriendlyName-match'Hands-Free'}
$db=@{};foreach($dev in $d){$bp=Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName $bk -EA 0;if($bp-and$null-ne$bp.Data){$bl=[int]$bp.Data;if($bl-ge0-and$bl-le100){$n=$dev.FriendlyName-replace' Hands-Free.*$','';$cp=Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName $ck -EA 0;$ci=if($cp-and$cp.Data){$cp.Data.ToString()}else{''};$ia=$ci-and$ac.ContainsKey($ci);$db[$dev.InstanceId]=[PSCustomObject]@{Name=$n;BatteryLevel=$bl;IsActive=$ia}}}}
$g=@{};foreach($i in $db.Values){if($i.IsActive-or(-not$g[$i.Name])){$g[$i.Name]=$i}};@($g.Values)|ConvertTo-Json -Compress`

    logAppEvent('Bluetooth: Fetching battery data...')
    const startTime = performance.now()
    const encoded = encodePS(psScript)

    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      {
        encoding: 'utf8',
        timeout: 20000,
        windowsHide: true,
      },
    )

    const execTime = performance.now() - startTime

    if (stderr && !stderr.includes('CLIXML') && !stderr.includes('progress')) {
      logError('Bluetooth', 'PowerShell stderr', stderr.substring(0, 500))
    }

    const trimmed = stdout.trim()

    if (!trimmed || trimmed === 'null' || trimmed === '' || trimmed === '[]') {
      logAppEvent(`Bluetooth: No devices found (${execTime.toFixed(0)}ms)`)
      return { devices: [], activeDevice: null, timestamp: new Date().toISOString() }
    }

    // Parse devices array directly (no wrapper object)
    // biome-ignore lint/suspicious/noExplicitAny: PowerShell output parsing
    let parsedDevices: any[] = []
    try {
      const parsed = JSON.parse(trimmed)
      parsedDevices = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      logError('Bluetooth', 'Failed to parse JSON', { output: trimmed.substring(0, 300) })
      return null
    }

    const devices: BluetoothDevice[] = parsedDevices
      .filter((d) => d && d.Name && typeof d.BatteryLevel === 'number')
      .map((d) => ({
        name: d.Name,
        batteryLevel: d.BatteryLevel,
        isActive: Boolean(d.IsActive),
      }))

    logAppEvent(`Bluetooth: Found ${devices.length} device(s) in ${execTime.toFixed(0)}ms`)
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
