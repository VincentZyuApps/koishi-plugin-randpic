import { Context, h } from 'koishi'
import { Config, usage, ImageLibrary } from './config'
import { SearchService } from './search'

export const name = 'randpic'
export { Config, usage }

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('randpic')

  // 存储所有已启用的图片库服务
  const searchServices = new Map<string, SearchService>()

  // 获取已启用的图片库列表
  const enabledLibraries = config.imageLibraries.filter(lib => lib.enabled && lib.command && lib.imageDir)

  if (enabledLibraries.length === 0) {
    logger.warn('没有启用任何图片库，请在配置中添加')
    return
  }

  // 为每个图片库创建 SearchService
  for (const lib of enabledLibraries) {
    const service = new SearchService(ctx, config, lib.imageDir)
    searchServices.set(lib.command, service)
  }

  // 为每个图片库注册命令
  for (const lib of enabledLibraries) {
    const searchService = searchServices.get(lib.command)!
    const cmdName = lib.command

    // 主命令
    ctx.command(`${cmdName} [...keywords:string]`, `随机图片 (${lib.imageDir})`)
      .action(async ({ session }, ...keywords) => {
        let result

        if (keywords.length === 0) {
          // 无关键词，随机返回
          const file = searchService.getRandomImage()
          if (!file) {
            return `📭 图片库为空，请检查目录: ${searchService.getImageDir()}`
          }
          result = { file, matchType: 'random' as const }
        } else {
          // 有关键词，搜索
          result = await searchService.search(keywords)
          if (!result) {
            // 搜索无结果，随机返回一张
            const file = searchService.getRandomImage()
            if (!file) {
              return `🔍 没有找到匹配「${keywords.join(' ')}」的图片`
            }
            result = { file, matchType: 'random' as const }
            
            if (config.debug) {
              logger.info(`[${cmdName}] 搜索无结果，随机返回: ${file.filename}`)
            }
          }
        }

        const { file, matchType, score } = result
        const imageUrl = searchService.getImageUrl(file.filepath)
        const fileInfo = searchService.getFileInfo(file.filepath)

        // 解析输出格式模板
        let output = config.outputFormat || '${IMAGE}'

        // 匹配类型的中文映射
        const matchTypeMap = {
          'substring': '子串匹配',
          'vector': '向量搜索',
          'random': '随机返回',
        }

        // 替换占位符
        output = output
          .replace(/\$\{IMAGE\}/g, '{{IMAGE_PLACEHOLDER}}')  // 临时替换
          .replace(/\$\{NAME\}/g, file.filename)
          .replace(/\$\{SIZE\}/g, fileInfo.size)
          .replace(/\$\{TIME\}/g, fileInfo.time)
          .replace(/\$\{PATH\}/g, file.filepath)
          .replace(/\$\{MATCH_TYPE\}/g, matchTypeMap[matchType])
          .replace(/\$\{SCORE\}/g, score !== undefined ? `${(score * 100).toFixed(1)}%` : '-')
          .replace(/\$\{TAB\}/g, '<pre>\t</pre>')  // 制表符
          .replace(/\\n/g, '\n')  // 处理换行符

        // 构建消息：把 IMAGE 占位符替换为实际图片
        const parts = output.split('{{IMAGE_PLACEHOLDER}}')
        const messages: (string | ReturnType<typeof h.image>)[] = []

        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            messages.push(parts[i])
          }
          if (i < parts.length - 1) {
            messages.push(h.image(imageUrl))
          }
        }

        return messages
      })

    // 刷新缓存命令
    ctx.command(`${cmdName}.refresh`, '刷新图片缓存')
      .action(async () => {
        const images = searchService.scanImages()
        return `✅ [${cmdName}] 缓存已刷新，共 ${images.length} 张图片`
      })

    // 统计命令
    ctx.command(`${cmdName}.stats`, '查看图片库统计')
      .action(async () => {
        const images = searchService.getImageCache()
        const imageCount = images.length

        let msg = `📊 图片库统计 [${cmdName}]\n`
        msg += `━━━━━━━━━━━━━━\n`
        msg += `📁 图片数量: ${imageCount}\n`
        msg += `📂 图片目录: ${searchService.getImageDir()}\n`
        msg += `🔍 子文件夹: ${config.searchSubfolders ? '✅' : '❌'}\n`

        msg += `\n🐳 Qdrant: ${config.enableQdrant ? '✅ 已启用' : '❌ 未启用'}\n`
        msg += `🧠 本地 Embedding: ${config.enableLocalEmbedding ? '✅ 已启用' : '❌ 未启用'}\n`

        if (config.enableQdrant && config.enableLocalEmbedding) {
          msg += `\n🌐 Qdrant 地址: ${config.qdrantHost}:${config.qdrantPort}\n`
          msg += `🤖 模型: ${config.embeddingModel}\n`
          msg += `📊 相似度阈值: ${config.similarityThreshold}`
        } else if (config.enableQdrant && !config.enableLocalEmbedding) {
          msg += `\n⚠️ 需要同时启用 Qdrant 和本地 Embedding 才能使用向量搜索`
        }

        return msg
      })

    // 索引命令
    ctx.command(`${cmdName}.index`, '重新索引图片库')
      .action(async ({ session }) => {
        if (!config.enableQdrant) {
          return '❌ Qdrant 未启用，请在配置中开启「🔌 启用 Qdrant 向量搜索」'
        }

        if (!config.enableLocalEmbedding) {
          return '❌ 本地 Embedding 未启用，请在配置中开启「🧠 启用本地 Embedding」'
        }

        await session.send(`🔄 [${cmdName}] 开始索引图片库...（首次加载模型可能需要几分钟）`)

        try {
          const count = await searchService.indexImages((msg) => {
            logger.info(`[${cmdName}] ${msg}`)
          })
          return `✅ [${cmdName}] 索引完成！共 ${count} 张图片`
        } catch (error) {
          logger.error(`[${cmdName}] 索引失败:`, error)
          return `❌ 索引失败: ${error.message}`
        }
      })

    logger.info(`📌 已注册指令: ${cmdName} -> ${lib.imageDir}`)
  }

  // 全局统计命令
  ctx.command('randpic-all', '查看所有图片库统计')
    .action(async () => {
      let msg = `📊 全部图片库统计\n`
      msg += `━━━━━━━━━━━━━━\n`

      let totalCount = 0
      for (const lib of enabledLibraries) {
        const service = searchServices.get(lib.command)!
        const count = service.getImageCache().length
        totalCount += count
        msg += `\n📌 ${lib.command}\n`
        msg += `   📂 ${service.getImageDir()}\n`
        msg += `   📁 ${count} 张图片\n`
      }

      msg += `\n━━━━━━━━━━━━━━\n`
      msg += `📊 总计: ${enabledLibraries.length} 个图片库, ${totalCount} 张图片`

      return msg
    })

  // 全局刷新命令
  ctx.command('randpic-all.refresh', '刷新所有图片库缓存')
    .action(async () => {
      let totalCount = 0
      for (const service of searchServices.values()) {
        totalCount += service.scanImages().length
      }
      return `✅ 全部缓存已刷新，共 ${totalCount} 张图片`
    })

  // 启动时扫描所有图片
  ctx.on('ready', () => {
    let totalCount = 0
    for (const [cmd, service] of searchServices) {
      const count = service.scanImages().length
      totalCount += count
      logger.info(`📌 [${cmd}] 已加载 ${count} 张图片`)
    }
    logger.info(`📊 总计加载 ${totalCount} 张图片，${enabledLibraries.length} 个图片库`)
  })
}
