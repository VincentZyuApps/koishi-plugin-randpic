import { Context } from 'koishi'
import { Config } from './config'
import axios from 'axios'

export interface ImagePoint {
  id: string
  filename: string
  filepath: string
  vector?: number[]
}

export interface SearchResult {
  filename: string
  filepath: string
  score: number
}

export class QdrantClient {
  private ctx: Context
  private config: Config
  private baseUrl: string

  constructor(ctx: Context, config: Config) {
    this.ctx = ctx
    this.config = config
    this.baseUrl = `http://${config.qdrantHost}:${config.qdrantPort}`
  }

  private log(message: string, ...args: any[]) {
    if (this.config.debug) {
      this.ctx.logger('randpic').info(`[Qdrant] ${message}`, ...args)
    }
  }

  /**
   * 检查 Qdrant 服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.ctx.http.get(`${this.baseUrl}/collections`)
      return true
    } catch (error) {
      this.log('Qdrant 服务不可用:', error.message)
      return false
    }
  }

  /**
   * 确保集合存在，不存在则创建
   */
  async ensureCollection(vectorSize: number): Promise<void> {
    const collectionName = this.config.collectionName

    try {
      // 检查集合是否存在
      await this.ctx.http.get(`${this.baseUrl}/collections/${collectionName}`)
      this.log(`集合 ${collectionName} 已存在`)
    } catch (error) {
      // 集合不存在，创建新集合
      this.log(`创建集合 ${collectionName}，向量维度: ${vectorSize}`)
      await this.ctx.http.put(`${this.baseUrl}/collections/${collectionName}`, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      })
    }
  }

  /**
   * 删除集合
   */
  async deleteCollection(): Promise<void> {
    try {
      await this.ctx.http.delete(`${this.baseUrl}/collections/${this.config.collectionName}`)
      this.log(`集合 ${this.config.collectionName} 已删除`)
    } catch (error) {
      // 集合可能不存在，忽略错误
    }
  }

  /**
   * 批量插入向量
   */
  async upsertPoints(points: ImagePoint[], onProgress?: (current: number, total: number) => void): Promise<void> {
    const collectionName = this.config.collectionName

    // 分批插入，每批 20 个（减小批次大小避免连接被关闭）
    const batchSize = 20
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize)

      const qdrantPoints = batch.map((point, idx) => ({
        id: i + idx,  // 使用数字 ID
        vector: point.vector,
        payload: {
          filename: point.filename,
          filepath: point.filepath,
        },
      }))

      // 使用 axios 避免 undici/fetch 的问题
      await axios.put(
        `${this.baseUrl}/collections/${collectionName}/points`,
        { points: qdrantPoints },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,  // 30 秒超时
        }
      )

      const current = Math.min(i + batchSize, points.length)
      this.log(`已插入 ${current}/${points.length} 个向量`)
      onProgress?.(current, points.length)
    }
  }

  /**
   * 向量搜索
   */
  async search(vector: number[], topK?: number): Promise<SearchResult[]> {
    const collectionName = this.config.collectionName
    const limit = topK ?? this.config.topK

    try {
      const response = await this.ctx.http.post(
        `${this.baseUrl}/collections/${collectionName}/points/search`,
        {
          vector,
          limit,
          with_payload: true,
        }
      )

      const results: SearchResult[] = response.result.map((item: any) => ({
        filename: item.payload.filename,
        filepath: item.payload.filepath,
        score: item.score,
      }))

      this.log(`搜索返回 ${results.length} 个结果`)
      return results
    } catch (error) {
      this.log('搜索失败:', error.message)
      return []
    }
  }

  /**
   * 获取集合中的点数量
   */
  async getPointCount(): Promise<number> {
    try {
      const response = await this.ctx.http.get(
        `${this.baseUrl}/collections/${this.config.collectionName}`
      )
      return response.result?.points_count ?? 0
    } catch (error) {
      return 0
    }
  }
}
