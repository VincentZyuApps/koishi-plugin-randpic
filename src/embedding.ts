import { Context } from 'koishi'
import path from 'path'
import { Config } from './config'

// 动态导入 transformers.js
let pipeline: any = null
let extractor: any = null

// 标记是否已设置全局代理
let globalProxySet = false

export class EmbeddingService {
  private ctx: Context
  private config: Config
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor(ctx: Context, config: Config) {
    this.ctx = ctx
    this.config = config
  }

  private log(message: string, ...args: any[]) {
    if (this.config.debug) {
      this.ctx.logger('randpic').info(`[Embedding] ${message}`, ...args)
    }
  }

  /**
   * 设置全局代理 (使用 undici 拦截原生 fetch)
   * Node.js 18+ 的 fetch 基于 undici，必须用 setGlobalDispatcher 才能代理
   */
  private async setupGlobalProxy(): Promise<void> {
    if (!this.config.enableProxy) return
    if (globalProxySet) return  // 避免重复设置

    const { proxyProtocol, proxyHost, proxyPort } = this.config
    const proxyUrl = `${proxyProtocol}://${proxyHost}:${proxyPort}`

    try {
      // 对于 socks 代理，需要用 socks-proxy-agent 创建一个 http.Agent
      // 然后用 undici 的 Agent 包装它
      if (proxyProtocol.startsWith('socks')) {
        // socks 代理需要特殊处理：用 socks-proxy-agent
        const { SocksProxyAgent } = require('socks-proxy-agent')
        const socksAgent = new SocksProxyAgent(proxyUrl)
        
        // 覆盖全局 fetch
        const originalFetch = globalThis.fetch
        globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const https = require('https')
          const http = require('http')
          
          // 如果是 https 请求，使用我们的 socks agent
          const urlStr = typeof input === 'string' ? input : input.toString()
          if (urlStr.startsWith('https://')) {
            const customFetch = await import('node-fetch').catch(() => null)
            if (customFetch) {
              // 使用 node-fetch (如果可用)
              return customFetch.default(input as any, { 
                ...init as any, 
                agent: socksAgent 
              }) as any
            }
          }
          
          // fallback: 尝试用环境变量 (可能不生效，但试一下)
          return originalFetch(input, init)
        }
        
        this.log(`已启用 SOCKS 代理 (fetch override): ${proxyUrl}`)
      } else {
        // HTTP/HTTPS 代理：使用 undici 的 ProxyAgent
        const { ProxyAgent, setGlobalDispatcher } = require('undici')
        const dispatcher = new ProxyAgent(proxyUrl)
        setGlobalDispatcher(dispatcher)
        this.log(`已启用 HTTP 代理 (undici): ${proxyUrl}`)
      }
      
      globalProxySet = true
    } catch (error) {
      this.ctx.logger('randpic').warn(`代理设置失败: ${error.message}`)
      // 尝试设置环境变量作为 fallback
      process.env.HTTP_PROXY = proxyUrl
      process.env.HTTPS_PROXY = proxyUrl
      process.env.http_proxy = proxyUrl
      process.env.https_proxy = proxyUrl
      this.log(`已设置代理环境变量 (fallback): ${proxyUrl}`)
    }
  }

  /**
   * 初始化 Embedding 模型
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    await this.initPromise
  }

  private async _doInitialize(): Promise<void> {
    try {
      this.log(`正在加载模型: ${this.config.embeddingModel}`)

      // 设置全局代理（如果启用）- 现在是 async
      await this.setupGlobalProxy()

      // 动态导入
      const transformers = await import('@xenova/transformers')
      pipeline = transformers.pipeline

      // 选择模型来源：本地目录或在线模型
      // config.localModelDir 已经是绝对路径（在 config.ts 中通过 path.resolve 设置默认值）
      const localModelDir = (this.config.localModelDir || path.resolve(__dirname, '../assets')).trim()

      // 设置缓存目录和其他选项
      if (transformers.env) {
        // 允许本地模型
        transformers.env.allowLocalModels = true
        // 将缓存目录固定到插件内，避免每次重启重复下载
        const cacheDir = path.resolve(__dirname, '../.cache/transformers')
        transformers.env.cacheDir = cacheDir
        this.log(`模型缓存目录: ${cacheDir}`)

        // 如果有本地模型，设置 localModelPath 为模型目录的父目录
        if (this._hasLocalModel(localModelDir)) {
          transformers.env.localModelPath = localModelDir
          this.log(`设置本地模型路径: ${localModelDir}`)
        }
      }

      let modelSource: string
      let useLocalFiles = false
      if (this._hasLocalModel(localModelDir)) {
        // 本地模型：使用空字符串或 '.' 表示从 localModelPath 加载
        modelSource = '.'
        useLocalFiles = true
        this.log(`使用本地模型目录: ${localModelDir}`)
      } else {
        // 无本地模型，启用代理后走在线下载
        await this.setupGlobalProxy()
        modelSource = this.config.embeddingModel
        this.log(`未找到本地模型，使用在线模型: ${modelSource}`)
      }

      extractor = await pipeline('feature-extraction', modelSource, {
        quantized: true,  // 使用量化模型，更小更快
        local_files_only: useLocalFiles,  // 本地模型时不要尝试从 HuggingFace 下载
      })

      this.initialized = true
      this.log('模型加载完成')
    } catch (error) {
      this.ctx.logger('randpic').error('模型加载失败:', error)
      throw error
    }
  }

  private _hasLocalModel(dir: string): boolean {
    const fs = require('fs')
    const pathExists = (p: string) => {
      try { return fs.statSync(p).isFile() }
      catch { return false }
    }
    const hasConfig = pathExists(path.resolve(dir, 'config.json'))
    const hasTokenizer = pathExists(path.resolve(dir, 'tokenizer.json'))
    const hasOnnxQuant = pathExists(path.resolve(dir, 'onnx/model_quantized.onnx'))
    const hasOnnx = pathExists(path.resolve(dir, 'onnx/model.onnx'))
    return hasConfig && hasTokenizer && (hasOnnxQuant || hasOnnx)
  }

  /**
   * 获取文本的 embedding 向量
   */
  async embed(text: string): Promise<number[]> {
    await this.initialize()

    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    })

    // 转换为普通数组
    return Array.from(output.data as Float32Array)
  }

  /**
   * 批量获取 embedding
   */
  async embedBatch(texts: string[], onProgress?: (current: number, total: number) => void): Promise<number[][]> {
    await this.initialize()

    const results: number[][] = []
    const batchSize = 32  // 每批处理数量

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      for (const text of batch) {
        const vector = await this.embed(text)
        results.push(vector)
      }

      if (onProgress) {
        onProgress(Math.min(i + batchSize, texts.length), texts.length)
      }
    }

    return results
  }

  /**
   * 获取向量维度
   */
  async getVectorSize(): Promise<number> {
    await this.initialize()
    const testVector = await this.embed('test')
    return testVector.length
  }

  /**
   * 检查模型是否已加载
   */
  isReady(): boolean {
    return this.initialized
  }
}
