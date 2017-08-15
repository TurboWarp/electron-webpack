import BluebirdPromise from "bluebird-lst"
import { blue } from "chalk"
import { ChildProcess, spawn } from "child_process"
import * as path from "path"
import { ChildProcessManager, PromiseNotifier } from "./ChildProcessManager"
import { getCommonEnv, LineFilter, logError, logProcess, logProcessErrorOutput } from "./devUtil"

const debug = require("debug")("electron-webpack")

function spawnWds(projectDir: string) {
  const isWin = process.platform === "win32"
  const webpackDevServerPath = path.join(projectDir, "node_modules", ".bin", "webpack-dev-server" + (isWin ? ".cmd" : ""))
  debug(`Start renderer WDS ${webpackDevServerPath}`)
  const args = ["--color", "--config", path.join(__dirname, "../../webpack.renderer.config.js")]
  if (isWin) {
    args.unshift(webpackDevServerPath)
  }
  return spawn(isWin ? path.join(__dirname, "../../vendor/runnerw.exe") : webpackDevServerPath, args, {
    env: getCommonEnv(),
  })
}

// 1. in another process to speedup compilation
// 2. some loaders detect webpack-dev-server hot mode only if run as CLI
export function startRenderer(projectDir: string) {
  const lineFilter = new CompoundRendererLineFilter([
    new OneTimeLineFilter("Project is running at "),
    new OneTimeLineFilter("webpack output is served from "),
  ])
  return new BluebirdPromise((resolve: (() => void) | null, reject: ((error: Error) => void) | null) => {
    let devServerProcess: ChildProcess | null
    try {
      devServerProcess = spawnWds(projectDir)
    }
    catch (e) {
      reject!(e)
      return
    }

    //tslint:disable-next-line:no-unused-expression
    new ChildProcessManager(devServerProcess, "Renderer WDS", new PromiseNotifier(resolve, reject))
    devServerProcess.on("error", error => {
      if (reject == null) {
        logError("Renderer", error)
      }
      else {
        reject(error)
        reject = null
      }
    })

    devServerProcess.stdout.on("data", (data: string) => {
      logProcess("Renderer", data, blue, lineFilter)

      const r = resolve
      // we must resolve only after compilation, otherwise devtools disconnected
      if (r != null && data.includes("webpack: Compiled successfully.")) {
        resolve = null
        r()
      }
    })

    logProcessErrorOutput("Renderer", devServerProcess)
  })
}

class OneTimeLineFilter implements LineFilter {
  private filtered = false

  constructor(private readonly prefix: string) {
  }

  filter(line: string) {
    if (!this.filtered && line.startsWith(this.prefix)) {
      this.filtered = true
      return false

    }
    return true
  }
}

class CompoundRendererLineFilter implements LineFilter {
  constructor(private readonly filters: Array<LineFilter>) {
  }

  filter(line: string) {
    return !this.filters.some(it => !it.filter(line))
  }
}