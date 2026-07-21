import { Schema } from 'koishi'
import path from 'path'

export interface ImageLibrary {
  command: string
  imageDir: string
  enabled: boolean
}

export interface Config {
  imageLibraries: ImageLibrary[]
  searchSubfolders: boolean
  autoRefreshImageCache: boolean
  imageCacheTtlSec: number

  enableQdrant: boolean
  qdrantHost: string
  qdrantPort: number
  collectionName: string

  enableLocalEmbedding: boolean
  embeddingModel: string
  localModelDir?: string
  topK: number
  similarityThreshold: number

  enableOllamaVision: boolean
  ollamaHost: string
  ollamaPort: number
  ollamaVisionModel: string
  ollamaTimeout: number
  ollamaPrompt: string
  ollamaMaxRetries: number

  enableProxy: boolean
  proxyProtocol: 'http' | 'https' | 'socks4' | 'socks5' | 'socks5h'
  proxyHost: string
  proxyPort: number

  toBase64: boolean
  outputFormat: string

  debug: boolean
}

const defaultImageLibraries: ImageLibrary[] = [
  {
    command: 'randpic',
    imageDir: '~/Images',
    enabled: true,
  },
]

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    imageLibraries: Schema.array(Schema.object({
      command: Schema.string().description('⌨️ 指令名称'),
      imageDir: Schema.string().description('📁 图片文件夹路径'),
      enabled: Schema.boolean().default(true).description('✅ 是否启用'),
    })).role('table').default(defaultImageLibraries)
      .description('🎨 图片库列表<br>▶ 每行配置一个指令，可以为不同文件夹注册不同的指令<br>▶ 路径支持 `~` 表示用户目录'),

    searchSubfolders: Schema.boolean()
      .default(true)
      .description('📂 是否递归搜索子文件夹'),

    autoRefreshImageCache: Schema.boolean()
      .default(true)
      .description('🔄 自动刷新图片缓存，使新增、删除和重命名的图片无需手动 refresh 即可生效')
      .experimental(),

    imageCacheTtlSec: Schema.number()
      .default(5)
      .min(0).max(3600).step(1)
      .description('⏱️ 图片缓存有效时间（秒）；设为 0 时每条图片命令都会重新扫描目录')
      .experimental(),
  }).description('📦 图片库配置'),

  Schema.object({
    enableQdrant: Schema.boolean()
      .default(false)
      .description('🔌 启用 Qdrant 向量搜索（子串匹配失败时的 fallback）'),

    qdrantHost: Schema.string()
      .default('127.0.0.1')
      .description('🌐 Qdrant 服务器地址'),

    qdrantPort: Schema.number()
      .default(6333)
      .min(1).max(65535)
      .description('🔢 Qdrant 服务器端口'),

    collectionName: Schema.string()
      .default('randpic_images')
      .description('🗄️ Qdrant 集合名称<br><span style="color:red">⚠️ 注意：不同的 Koishi randpic 插件实例若使用同一个 Qdrant 容器，必须配置不同的集合名称，否则会导致数据冲突！</span>'),
  }).description('🐳 Qdrant 向量数据库配置'),

  Schema.object({
    enableLocalEmbedding: Schema.boolean()
      .default(false)
      .description('🧠 启用本地 Embedding（Transformers.js，首次加载模型较慢）'),

    embeddingModel: Schema.union([
      Schema.const('Xenova/paraphrase-multilingual-MiniLM-L12-v2').description('🌍 多语言 MiniLM (推荐，384维)'),
      Schema.const('Xenova/multilingual-e5-small').description('🌏 多语言 E5-small (效果更好，384维)'),
      Schema.const('Xenova/bge-small-zh-v1.5').description('🇨🇳 中文 BGE-small (中文专用，512维)'),
    ])
      .default('Xenova/paraphrase-multilingual-MiniLM-L12-v2')
      .description('🤖 Embedding 模型选择'),

    localModelDir: Schema.string()
      .default(path.resolve(__dirname, '../assets'))
      .description('📁 本地模型目录（默认为插件 assets 目录）。目录需包含 tokenizer.json、config.json 以及 onnx/model_quantized.onnx 或 onnx/model.onnx。'),

    topK: Schema.number()
      .default(5)
      .min(1).max(50)
      .description('🔝 向量搜索返回的候选数量'),

    similarityThreshold: Schema.number()
      .default(0.3)
      .min(0).max(1).step(0.05)
      .description('📊 相似度阈值 (0-1)，低于此值不返回'),
  }).description('🧪 本地 Embedding 配置 (Transformers.js)'),

  Schema.object({
    enableOllamaVision: Schema.boolean()
      .default(false)
      .description('👁️ 启用 Ollama 视觉模型（索引时分析图片内容生成 tag，大幅提升搜索效果）'),

    ollamaHost: Schema.string()
      .default('127.0.0.1')
      .description('🌐 Ollama 服务器地址'),

    ollamaPort: Schema.number()
      .default(11434)
      .min(1).max(65535)
      .description('🔢 Ollama 服务器端口（默认 11434）'),

    ollamaVisionModel: Schema.string()
      .default('llava:7b')
      .description('🤖 Ollama 视觉模型名称（支持 llava、bakllava、moondream 等多模态模型）<br>💡 运行 <code>ollama pull llava:7b</code> 下载模型'),

    ollamaTimeout: Schema.number()
      .default(30000)
      .min(5000).max(120000)
      .step(1000)
      .description('⏱️ Ollama 请求超时时间（毫秒）'),

    ollamaPrompt: Schema.string()
      .role('textarea', { rows: [3, 5] })
      .default('Describe this image in detail. List key objects, colors, scene, mood, and actions as short English keywords separated by spaces.')
      .description('💬 Ollama 视觉分析提示词模板'),

    ollamaMaxRetries: Schema.number()
      .default(3)
      .min(0).max(10)
      .description('🔄 Ollama 分析失败重试次数（默认 3）'),
  }).description('🦙 Ollama 视觉模型配置'),

  Schema.object({
    enableProxy: Schema.boolean()
      .default(false)
      .description('🌐 启用代理（用于下载 Hugging Face 模型）'),

    proxyProtocol: Schema.union([
      Schema.const('http').description('HTTP 代理'),
      Schema.const('https').description('HTTPS 代理'),
      Schema.const('socks4').description('SOCKS4 代理'),
      Schema.const('socks5').description('SOCKS5 代理'),
      Schema.const('socks5h').description('SOCKS5h 代理 (远程 DNS)'),
    ])
      .default('socks5h')
      .description('🔒 代理协议'),

    proxyHost: Schema.string()
      .default('127.0.0.1')
      .description('📍 代理地址'),

    proxyPort: Schema.number()
      .default(7890)
      .min(1).max(65535)
      .description('🔢 代理端口'),
  }).description('🌐 网络代理配置（下载模型用）'),

  Schema.object({
    toBase64: Schema.boolean()
      .default(true)
      .description('🔄 转换为 Base64 发送（兼容性更好）'),

    outputFormat: Schema.string()
      .role('textarea', { rows: [3, 5] })
      .default('${IMAGE}\n文件名称：${NAME}\n文件大小：${SIZE}\n修改日期：${TIME}\n匹配方式：${MATCH_TYPE}\n相似度：${SCORE}')
      .description(`📝 输出格式模板<br>
▶ 仅图片：\`\${IMAGE}\`<br>
▶ 图+文件名：\`\${IMAGE}\\n📁 \${NAME}\`<br>
▶ 完整信息：\`\${IMAGE}\\n📁 \${NAME}\\n📐 \${SIZE}\\n🕐 \${TIME}\`<br>
▶ 可用变量：\`IMAGE\`、\`NAME\`、\`SIZE\`、\`TIME\`、\`PATH\`、\`MATCH_TYPE\`、\`SCORE\`、\`TAB\`<br>
其中 \\n 表示换行，\${TAB} 表示制表符`),
  }).description('🖼️ 图片发送设置'),

  Schema.object({
    debug: Schema.boolean()
      .default(false)
      .description('🐛 调试模式（输出详细日志）'),
  }).description('🛠️ 调试设置'),
])
