import { Context } from 'koishi'
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

      // 设置缓存目录和其他选项
      if (transformers.env) {
        // 允许本地模型
        transformers.env.allowLocalModels = true
      }

      // 创建 feature-extraction pipeline
      extractor = await pipeline('feature-extraction', this.config.embeddingModel, {
        quantized: true,  // 使用量化模型，更小更快
      })

      this.initialized = true
      this.log('模型加载完成')
    } catch (error) {
      this.ctx.logger('randpic').error('模型加载失败:', error)
      throw error
    }
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
