import { useState } from 'react'
import { api } from '@/libs/api'
import { IPC } from '~/shared/ipc'

export function App() {
  const { ping } = api
  const [versions] = useState(api.process().versions)

  return (
    <>
      <img
        alt="logo"
        src={'./electron.svg'}
        style={{ WebkitUserDrag: 'none' }}
        className="mb-5 h-32 w-32 transition-[filter] duration-300 hover:drop-shadow-[0_0_1.2em_#6988e6aa]"
      />
      <img
        alt="logo"
        src={'./icon.png'}
        style={{ WebkitUserDrag: 'none' }}
        className="mb-5 h-32 w-32 transition-[filter] duration-300 hover:drop-shadow-[0_0_1.2em_#6988e6aa]"
      />
      <span className="text-sm leading-4 text-stone-50/60 font-semibold mb-2.5">
        Powered by electron-vite
      </span>

      <div className="text-3xl text-stone-50/86 font-bold leading-8 text-center mx-2.5 py-4">
        Build an Electron app with{' '}
        <span className="bg-linear-to-br from-sky-600 from-55% to-indigo-700 bg-clip-text text-transparent font-bold">
          React
        </span>
        &nbsp;and{' '}
        <span className="bg-linear-to-br from-blue-500 from-45% to-orange-600 bg-clip-text text-transparent font-bold">
          TypeScript
        </span>
      </div>

      <p className="text-base leading-6 text-stone-50/60 font-semibold">
        Please try pressing <code>F12</code> to open the devTool and console.log({IPC.PING});
      </p>

      <div className="flex pt-8 -m-1.5 flex-wrap justify-start">
        <div className="shrink-0 p-1.5">
          <a
            href="https://electron-vite.org/"
            target="_blank"
            rel="noreferrer"
            className="cursor-pointer no-underline inline-block border border-transparent text-center font-semibold whitespace-nowrap rounded-2xl px-5 leading-9 text-sm text-stone-50/86 bg-zinc-700 hover:border-zinc-600 hover:bg-zinc-600"
          >
            Documentation
          </a>
        </div>
        <div className="shrink-0 p-1.5">
          <a
            target="_blank"
            rel="noreferrer"
            onClick={ping}
            className="cursor-pointer no-underline inline-block border border-transparent text-center font-semibold whitespace-nowrap rounded-2xl px-5 leading-9 text-sm text-stone-50/86 bg-zinc-700 hover:border-zinc-600 hover:bg-zinc-600"
          >
            Send IPC
          </a>
        </div>
      </div>

      <ul className="absolute bottom-4 m-0 my-auto py-4 px-0 font-['Menlo','Lucida_Console',monospace] inline-flex overflow-hidden items-center rounded-2xl bg-zinc-800 backdrop-blur-xl">
        <li className="block float-left border-r border-zinc-500 px-5 text-sm leading-3.5 opacity-80">
          Electron v{versions.electron}
        </li>
        <li className="block float-left border-r border-zinc-500 px-5 text-sm leading-3.5 opacity-80">
          Chromium v{versions.chrome}
        </li>
        <li className="block float-left px-5 text-sm leading-3.5 opacity-80">
          Node v{versions.node}
        </li>
      </ul>
    </>
  )
}
