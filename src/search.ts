import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import url from 'node:url'
import { Context } from 'koishi'
import { Config } from './config'
import { QdrantClient, SearchResult } from './qdrant'
import { EmbeddingService } from './embedding'
import { OllamaVisionService } from './ollama'

export interface ImageFile {
  filename: string
  filepath: string
  virtualName: string
}

export interface MatchResult {
  file: ImageFile
  matchType: 'substring' | 'vector' | 'random'
  score?: number
  tags?: string
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']

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
  private ollama: OllamaVisionService
  private imageCache: ImageFile[] = []
  private imageCacheInitialized = false
  private imageCacheUpdatedAt = 0
  private imageCacheRevision = 0

  constructor(ctx: Context, config: Config, imageDir: string) {
    this.ctx = ctx
    this.config = config
    this.imageDir = expandPath(imageDir)
    this.qdrant = new QdrantClient(ctx, config)
    this.embedding = new EmbeddingService(ctx, config)
    this.ollama = new OllamaVisionService(ctx, config)
  }

  private log(message: string, ...args: any[]) {
    if (this.config.debug) {
      this.ctx.logger('randpic').info(`[Search] ${message}`, ...args)
    }
  }

  private updateImageCache(images: ImageFile[]): ImageFile[] {
    this.imageCache = images
    this.imageCacheInitialized = true
    this.imageCacheUpdatedAt = Date.now()
    this.imageCacheRevision += 1
    return images
  }

  private shouldRefreshImageCache(): boolean {
    if (!this.imageCacheInitialized) return true
    if (!this.config.autoRefreshImageCache) return false

    const ttlMs = Math.max(0, this.config.imageCacheTtlSec ?? 5) * 1000
    return ttlMs === 0 || Date.now() - this.imageCacheUpdatedAt >= ttlMs
  }

  scanImages(): ImageFile[] {
    const baseDir = this.imageDir

    if (!fs.existsSync(baseDir)) {
      this.ctx.logger('randpic').warn(`图片目录不存在: ${baseDir}`)
      return this.updateImageCache([])
    }

    const images: ImageFile[] = []

    const scan = (dir: string, prefix: string = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory() && this.config.searchSubfolders) {
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
    this.updateImageCache(images)
    this.log(`扫描到 ${images.length} 张图片 (目录: ${baseDir})`)
    return images
  }

  getImageCache(forceRefresh = false): ImageFile[] {
    if (forceRefresh || this.shouldRefreshImageCache()) {
      this.scanImages()
    }
    return this.imageCache
  }

  getImageDir(): string {
    return this.imageDir
  }

  substringSearch(keywords: string[], images = this.getImageCache()): ImageFile[] {
    const matched = images.filter(img => {
      const searchTarget = img.virtualName.toLowerCase()
      return keywords.every(kw => searchTarget.includes(kw.toLowerCase()))
    })

    this.log(`子串匹配: "${keywords.join(' ')}" -> ${matched.length} 个结果`)
    return matched
  }

  async vectorSearch(query: string): Promise<SearchResult[]> {
    if (!this.config.enableQdrant || !this.config.enableLocalEmbedding) {
      return []
    }

    const available = await this.qdrant.isAvailable()
    if (!available) {
      this.ctx.logger('randpic').warn('Qdrant 服务不可用，跳过向量搜索')
      return []
    }

    const queryVector = await this.embedding.embed(query)
    const results = await this.qdrant.search(queryVector)
    const filtered = results.filter(r => r.score >= this.config.similarityThreshold)
    this.log(`向量搜索: "${query}" -> ${filtered.length} 个结果 (阈值: ${this.config.similarityThreshold})`)

    return filtered
  }

  async search(keywords: string[]): Promise<MatchResult | null> {
    const query = keywords.join(' ')
    const initialRevision = this.imageCacheRevision
    let images = this.getImageCache()
    let substringResults = this.substringSearch(keywords, images)

    if (
      substringResults.length === 0
      && this.config.autoRefreshImageCache
      && this.imageCacheRevision === initialRevision
    ) {
      images = this.scanImages()
      substringResults = this.substringSearch(keywords, images)
    }

    if (substringResults.length > 0) {
      let selected = substringResults[Math.floor(Math.random() * substringResults.length)]

      if (this.config.autoRefreshImageCache && !fs.existsSync(selected.filepath)) {
        images = this.scanImages()
        substringResults = this.substringSearch(keywords, images)
        selected = substringResults[Math.floor(Math.random() * substringResults.length)]
      }

      if (!selected) return null
      return {
        file: selected,
        matchType: 'substring',
      }
    }

    if (this.config.enableQdrant && this.config.enableLocalEmbedding && query.trim()) {
      const vectorResults = await this.vectorSearch(query)
      if (vectorResults.length > 0) {
        for (const result of vectorResults) {
          const file = images.find(img => img.filepath === result.filepath)
          if (file && fs.existsSync(file.filepath)) {
            return {
              file,
              matchType: 'vector',
              score: result.score,
            }
          }
        }
      }
    }

    return null
  }

  getRandomImage(refreshCache = true): ImageFile | null {
    let images = refreshCache ? this.getImageCache() : this.imageCache
    if (images.length === 0) return null

    let selected = images[Math.floor(Math.random() * images.length)]
    if (this.config.autoRefreshImageCache && !fs.existsSync(selected.filepath)) {
      images = this.scanImages()
      if (images.length === 0) return null
      selected = images[Math.floor(Math.random() * images.length)]
    }
    return selected
  }

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

    const images = this.scanImages()
    if (images.length === 0) {
      throw new Error('没有找到图片')
    }

    const useVision = this.config.enableOllamaVision
    let descriptions: string[] = []

    if (useVision) {
      const ollamaAvailable = await this.ollama.isAvailable()
      if (!ollamaAvailable) {
        this.ctx.logger('randpic').warn('Ollama 服务不可用，降级为仅使用文件名索引')
        onProgress?.('⚠️ Ollama 不可用，使用文件名索引')
      } else {
        onProgress?.(`找到 ${images.length} 张图片，开始 Ollama 视觉分析...`)

        const imageBase64s = images.map(img => {
          const base64 = this.getImageBase64(img.filepath)
          return base64 || ''
        }).filter(b64 => b64)

        descriptions = await this.ollama.analyzeBatch(imageBase64s, (current, total) => {
          onProgress?.(`视觉分析中: ${current}/${total}`)
        })

        while (descriptions.length < images.length) {
          descriptions.push('')
        }
      }
    }

    onProgress?.(`找到 ${images.length} 张图片，开始生成向量...`)

    const vectorSize = await this.embedding.getVectorSize()

    await this.qdrant.deleteCollection()
    await this.qdrant.ensureCollection(vectorSize)

    const texts = images.map((img, i) => {
      const name = img.virtualName
        .replace(/\.[^.]+$/, '')
        .replace(/[_\-\/]/g, ' ')

      if (useVision && descriptions[i]) {
        return `${descriptions[i]} ${name}`
      }
      return name
    })

    const vectors = await this.embedding.embedBatch(texts, (current, total) => {
      onProgress?.(`生成向量中: ${current}/${total}`)
    })

    const points = images.map((img, i) => ({
      id: img.filepath,
      filename: img.filename,
      filepath: img.filepath,
      vector: vectors[i],
      tags: useVision ? descriptions[i] : null,
    }))

    onProgress?.('正在写入 Qdrant...')
    await this.qdrant.upsertPoints(points, (current, total) => {
      onProgress?.(`写入 Qdrant: ${current}/${total}`)
    })

    const mode = useVision && descriptions.some(d => d) ? '视觉增强' : '文件名'
    onProgress?.(`索引完成！共 ${images.length} 张图片（模式: ${mode}）`)
    return images.length
  }

  getFileInfo(filepath: string): { size: string; time: string } {
    try {
      const stats = fs.statSync(filepath)
      const sizeBytes = stats.size
      let size: string
      if (sizeBytes < 1024) {
        size = `${sizeBytes} B`
      } else if (sizeBytes < 1024 * 1024) {
        size = `${(sizeBytes / 1024).toFixed(2)} KB`
      } else {
        size = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
      }
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

  getImageBase64(filepath: string): string | null {
    try {
      const buffer = fs.readFileSync(filepath)
      return buffer.toString('base64')
    } catch (error) {
      this.ctx.logger('randpic').error('读取图片失败:', error)
      return null
    }
  }

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
