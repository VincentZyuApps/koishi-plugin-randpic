import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import url from 'node:url'
import { Context } from 'koishi'
import { Config } from './config'
import { QdrantClient, SearchResult } from './qdrant'
import { EmbeddingService } from './embedding'

export interface ImageFile {
  filename: string       // 文件名（不含路径）
  filepath: string       // 完整路径
  virtualName: string    // 虚拟名（包含子文件夹）
}

export interface MatchResult {
  file: ImageFile
  matchType: 'substring' | 'vector' | 'random'
  score?: number
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

/**
 * 展开路径中的 ~ 为用户目录
 */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

export class SearchService {
  private ctx: Context
  private config: Config
  private imageDir: string
  private qdrant: QdrantClient
  private embedding: EmbeddingService
  private imageCache: ImageFile[] = []

  constructor(ctx: Context, config: Config, imageDir: string) {
    this.ctx = ctx
    this.config = config
    this.imageDir = expandPath(imageDir)
    this.qdrant = new QdrantClient(ctx, config)
    this.embedding = new EmbeddingService(ctx, config)
  }

  private log(message: string, ...args: any[]) {
    if (this.config.debug) {
      this.ctx.logger('randpic').info(`[Search] ${message}`, ...args)
    }
  }

  /**
   * 扫描图片目录，获取所有图片文件
   */
  scanImages(): ImageFile[] {
    const baseDir = this.imageDir

    if (!fs.existsSync(baseDir)) {
      this.ctx.logger('randpic').warn(`图片目录不存在: ${baseDir}`)
      return []
    }

    const images: ImageFile[] = []

    const scan = (dir: string, prefix: string = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory() && this.config.searchSubfolders) {
          // 递归扫描子目录
          const newPrefix = prefix ? `${prefix}/${entry.name}` : entry.name
          scan(fullPath, newPrefix)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (IMAGE_EXTENSIONS.includes(ext)) {
            images.push({
              filename: entry.name,
              filepath: fullPath,
              virtualName: prefix ? `${prefix}/${entry.name}` : entry.name,
            })
          }
        }
      }
    }

    scan(baseDir)
    this.imageCache = images
    this.log(`扫描到 ${images.length} 张图片 (目录: ${baseDir})`)
    return images
  }

  /**
   * 获取缓存的图片列表
   */
  getImageCache(): ImageFile[] {
    if (this.imageCache.length === 0) {
      this.scanImages()
    }
    return this.imageCache
  }

  /**
   * 获取图片目录
   */
  getImageDir(): string {
    return this.imageDir
  }

  /**
   * 子串匹配搜索
   */
  substringSearch(keywords: string[]): ImageFile[] {
    const images = this.getImageCache()

    const matched = images.filter(img => {
      const searchTarget = img.virtualName.toLowerCase()
      // 所有关键词都要匹配
      return keywords.every(kw => searchTarget.includes(kw.toLowerCase()))
    })

    this.log(`子串匹配: "${keywords.join(' ')}" -> ${matched.length} 个结果`)
    return matched
  }

  /**
   * 向量搜索
   */
  async vectorSearch(query: string): Promise<SearchResult[]> {
    // 必须同时启用 Qdrant 和本地 Embedding
    if (!this.config.enableQdrant || !this.config.enableLocalEmbedding) {
      return []
    }

    // 检查 Qdrant 是否可用
    const available = await this.qdrant.isAvailable()
    if (!available) {
      this.ctx.logger('randpic').warn('Qdrant 服务不可用，跳过向量搜索')
      return []
    }

    // 获取查询向量
    const queryVector = await this.embedding.embed(query)

    // 搜索
    const results = await this.qdrant.search(queryVector)

    // 过滤低于阈值的结果
    const filtered = results.filter(r => r.score >= this.config.similarityThreshold)
    this.log(`向量搜索: "${query}" -> ${filtered.length} 个结果 (阈值: ${this.config.similarityThreshold})`)

    return filtered
  }

  /**
   * 综合搜索：先子串，再向量
   */
  async search(keywords: string[]): Promise<MatchResult | null> {
    const query = keywords.join(' ')

    // 1. 子串匹配
    const substringResults = this.substringSearch(keywords)
    if (substringResults.length > 0) {
      // 随机选一个
      const selected = substringResults[Math.floor(Math.random() * substringResults.length)]
      return {
        file: selected,
        matchType: 'substring',
      }
    }

    // 2. 向量搜索（如果同时启用 Qdrant 和本地 Embedding）
    if (this.config.enableQdrant && this.config.enableLocalEmbedding && query.trim()) {
      const vectorResults = await this.vectorSearch(query)
      if (vectorResults.length > 0) {
        // 选择得分最高的
        const best = vectorResults[0]
        const images = this.getImageCache()
        const file = images.find(img => img.filepath === best.filepath)
        if (file) {
          return {
            file,
            matchType: 'vector',
            score: best.score,
          }
        }
      }
    }

    return null
  }

  /**
   * 随机返回一张图片
   */
  getRandomImage(): ImageFile | null {
    const images = this.getImageCache()
    if (images.length === 0) return null
    return images[Math.floor(Math.random() * images.length)]
  }

  /**
   * 索引所有图片到 Qdrant
   */
  async indexImages(onProgress?: (message: string) => void): Promise<number> {
    if (!this.config.enableQdrant) {
      throw new Error('Qdrant 未启用，请在配置中开启')
    }

    if (!this.config.enableLocalEmbedding) {
      throw new Error('本地 Embedding 未启用，请在配置中开启')
    }

    const available = await this.qdrant.isAvailable()
    if (!available) {
      throw new Error('Qdrant 服务不可用，请检查 Docker 容器是否运行')
    }

    // 重新扫描图片
    const images = this.scanImages()
    if (images.length === 0) {
      throw new Error('没有找到图片')
    }

    onProgress?.(`找到 ${images.length} 张图片，开始生成向量...`)

    // 获取向量维度
    const vectorSize = await this.embedding.getVectorSize()

    // 删除旧集合并创建新集合
    await this.qdrant.deleteCollection()
    await this.qdrant.ensureCollection(vectorSize)

    // 生成所有图片的 embedding
    const texts = images.map(img => {
      // 用虚拟名（包含文件夹）作为文本
      const name = img.virtualName
        .replace(/\.[^.]+$/, '')  // 去掉扩展名
        .replace(/[_\-\/]/g, ' ') // 分隔符转空格
      return name
    })

    const vectors = await this.embedding.embedBatch(texts, (current, total) => {
      onProgress?.(`生成向量中: ${current}/${total}`)
    })

    // 构建点数据
    const points = images.map((img, i) => ({
      id: img.filepath,
      filename: img.filename,
      filepath: img.filepath,
      vector: vectors[i],
    }))

    // 插入 Qdrant（分批上传）
    onProgress?.('正在写入 Qdrant...')
    await this.qdrant.upsertPoints(points, (current, total) => {
      onProgress?.(`写入 Qdrant: ${current}/${total}`)
    })

    onProgress?.(`索引完成！共 ${images.length} 张图片`)
    return images.length
  }

  /**
   * 获取文件元信息
   */
  getFileInfo(filepath: string): { size: string; time: string } {
    try {
      const stats = fs.statSync(filepath)
      // 格式化文件大小
      const sizeBytes = stats.size
      let size: string
      if (sizeBytes < 1024) {
        size = `${sizeBytes} B`
      } else if (sizeBytes < 1024 * 1024) {
        size = `${(sizeBytes / 1024).toFixed(2)} KB`
      } else {
        size = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
      }
      // 格式化时间
      const time = stats.mtime.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      return { size, time }
    } catch {
      return { size: '未知', time: '未知' }
    }
  }

  /**
   * 获取 Base64 图片数据
   */
  getImageBase64(filepath: string): string | null {
    try {
      const buffer = fs.readFileSync(filepath)
      return buffer.toString('base64')
    } catch (error) {
      this.ctx.logger('randpic').error('读取图片失败:', error)
      return null
    }
  }

  /**
   * 获取图片 URL（file:// 或 base64）
   */
  getImageUrl(filepath: string): string {
    if (this.config.toBase64) {
      const base64 = this.getImageBase64(filepath)
      const ext = path.extname(filepath).toLowerCase().slice(1)
      const mime = ext === 'jpg' ? 'jpeg' : ext
      return `data:image/${mime};base64,${base64}`
    } else {
      return url.pathToFileURL(filepath).href
    }
  }
}
