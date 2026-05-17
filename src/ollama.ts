import { Context } from 'koishi'
import { Config } from './config'

export class OllamaVisionService {
  private ctx: Context
  private config: Config
  private baseUrl: string

  constructor(ctx: Context, config: Config) {
    this.ctx = ctx
    this.config = config
    this.baseUrl = `http://${config.ollamaHost}:${config.ollamaPort}`
  }

  private log(message: string, ...args: any[]) {
    if (this.config.debug) {
      this.ctx.logger('randpic').info(`[Ollama] ${message}`, ...args)
    }
  }

  /**
   * 检查 Ollama 服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ctx.http.get(`${this.baseUrl}/api/tags`, {
        timeout: this.config.ollamaTimeout,
      })
      this.log('Ollama 服务可用')
      return true
    } catch (error) {
      this.ctx.logger('randpic').warn(`Ollama 服务不可用: ${error.message}`)
      return false
    }
  }

  /**
   * 分析单张图片，返回描述性 tag（含重试机制）
   * @param imageBase64 图片 base64 数据（不含 data:image/xxx;base64, 前缀）
   * @returns 描述文本（如 "blue sky mountain lake cat"）
   */
  async analyzeImage(imageBase64: string): Promise<string> {
    const englishPrompt = `${this.config.ollamaPrompt}\n\nIMPORTANT: Respond in English ONLY. Ignore any non-English text in the image. Do not use Chinese or any other language.`
    const maxRetries = this.config.ollamaMaxRetries

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`正在分析图片 (尝试 ${attempt}/${maxRetries})，模型: ${this.config.ollamaVisionModel}`)

        const response = await this.ctx.http.post(
          `${this.baseUrl}/api/generate`,
          {
            model: this.config.ollamaVisionModel,
            prompt: englishPrompt,
            images: [imageBase64],
            stream: false,
          },
          {
            timeout: this.config.ollamaTimeout,
          }
        )

        const result = response.data || response
        const description = result.response?.trim() || ''

        if (!description) {
          throw new Error('Ollama 返回空响应')
        }

        this.log(`分析结果: ${description.substring(0, 100)}...`)
        return description
      } catch (error) {
        if (attempt === maxRetries) {
          this.ctx.logger('randpic').error(`图片分析失败 (${maxRetries} 次重试后): ${error.message}`)
          throw error
        }
        this.ctx.logger('randpic').warn(`第 ${attempt} 次分析失败，正在重试: ${error.message}`)
      }
    }

    return ''
  }

  /**
   * 批量分析图片
   * @param images 图片 base64 数组（不含 data:image/xxx;base64, 前缀）
   * @param onProgress 进度回调
   * @returns 描述文本数组
   */
  async analyzeBatch(
    images: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<string[]> {
    const results: string[] = []
    const total = images.length

    this.log(`开始批量分析 ${total} 张图片`)

    for (let i = 0; i < total; i++) {
      try {
        const description = await this.analyzeImage(images[i])
        results.push(description)
      } catch (error) {
        this.ctx.logger('randpic').warn(`第 ${i + 1} 张图片分析失败，使用空描述: ${error.message}`)
        results.push('')
      }

      if (onProgress) {
        onProgress(i + 1, total)
      }
    }

    this.log(`批量分析完成，成功 ${results.filter(r => r).length}/${total}`)
    return results
  }
}
