import { describe, expect, it } from 'vitest'
import { resolveWindowsCommand } from '../../../main/services/local-runtime/exec'

// npm 11's cmd-shim for a package bin, verbatim shape.
const NPM_SHIM = `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\..\\openclaw\\openclaw.mjs" %*\r\n`

describe('Windows commands never go through cmd.exe', () => {
  it('runs an npm cmd-shim as its script on Electron-as-Node', () => {
    const out = resolveWindowsCommand('/rt/node_modules/.bin/openclaw.cmd', ['--version'], () => NPM_SHIM)
    expect(out.node).toBe(true)
    expect(out.command).toBe(process.execPath)
    expect(out.args[0]!.replace(/\\/g, '/')).toMatch(/node_modules\/\.bin\/\.\.\/openclaw\/openclaw\.mjs$|node_modules\/openclaw\/openclaw\.mjs$/)
    expect(out.args.slice(1)).toEqual(['--version'])
  })
  it('maps our node.cmd to Electron, leaves .exe and unknown .cmd alone', () => {
    expect(resolveWindowsCommand('C:/x/node-bin/node.cmd', ['a'], () => '')).toEqual({ command: process.execPath, args: ['a'], node: true })
    expect(resolveWindowsCommand('C:/x/claude.exe', ['a']).node).toBe(false)
    expect(resolveWindowsCommand('C:/x/other.cmd', ['a'], () => '@echo hi').node).toBe(false)
  })
})
