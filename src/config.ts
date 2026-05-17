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

export const usage = `
## 🎲 Randpic - 智能随机图片

![Vector Search Preview](https://gitee.com/vincent-zyu/koishi-plugin-randpic/releases/download/randpic-vector-search-preview.png/randpic-vector-search-preview.png)

### 使用方式
- \`randpic\` - 随机返回一张图片（可在配置中自定义指令名）
- \`randpic 关键词\` - 搜索匹配的图片
- \`randpic.index\` - 重新索引图片库
- \`randpic.stats\` - 查看图片库统计
- \`randpic.refresh\` - 刷新图片缓存

### 多图片库支持
可以在「图片库列表」中配置多个指令，每个指令对应不同的图片文件夹。

### 搜索逻辑
1. **子串匹配**：优先在文件名中搜索包含关键词的图片
2. **向量搜索**：如果子串匹配失败且启用了 Qdrant + 本地 Embedding，使用语义搜索

### 🆕 Ollama 视觉增强（可选）
启用 Ollama 视觉模型后，索引时会使用多模态 AI（如 moondream、LLaVA等）分析图片内容，生成描述性 tag。
这样向量搜索不再依赖文件名，而是基于图片的实际内容，大幅提升搜索效果！

**前置条件：**
- 安装并运行 Ollama：<a href="https://ollama.com" target="_blank">https://ollama.com</a>
- 下载视觉模型：\`ollama pull llava:7b\`

**使用方式：**
1. 在插件配置中启用「👁️ 启用 Ollama 视觉模型」
2. 配置 Ollama 地址和模型名称（默认 \`127.0.0.1:11434\`，\`llava:7b\`）
3. 运行 \`randpic.index\` 重新索引图片库

**性能说明：**
- 索引速度：GPU 约 1-3 秒/张，CPU 约 5-15 秒/张
- 搜索速度：不变（毫秒级，Qdrant 直接查向量）
- 索引完成后可关闭 Ollama，搜索不需要它

---

### 🧪 技术架构说明

本插件使用两个核心依赖实现向量搜索：

| 依赖 | 作用 | 说明 |
|------|------|------|
| \`@xenova/transformers\` | **生成向量** | Transformers.js，在 Node.js 本地运行 AI 模型，将文件名文本转换为 384 维向量 |
| \`@qdrant/js-client-rest\` | **存储 & 搜索向量** | Qdrant 向量数据库的 REST 客户端，用于高效存储和相似度搜索 |

**工作流程：**
1. \`randpic.index\` 扫描图片 → Transformers.js 生成向量 → 存入 Qdrant
2. \`randpic 关键词\` 搜索时 → Transformers.js 将关键词转向量 → Qdrant 查找最相似的图片

---

### 📊 资源占用估算（约 1000 张图片）

**Transformers.js (本地 Embedding 模型)**
| 资源 | 首次索引 | 运行时搜索 | 说明 |
|------|----------|------------|------|
| **内存 (RAM)** | ~500MB - 800MB | ~400MB - 600MB | 模型常驻内存 |
| **CPU** | 高 (100%) | 低 (~5-10%) | 索引时密集计算，搜索时仅单次推理 |
| **索引耗时** | ~8-12 秒 | - | i5-10210U 约 8 秒生成 1000 个向量 |
| **模型缓存** | ~100MB | - | 首次下载后缓存到 ~/.cache |

**Qdrant (向量数据库 Docker 容器)**
| 资源 | 索引写入 | 运行时搜索 | 说明 |
|------|----------|------------|------|
| **内存 (RAM)** | ~100MB - 200MB | ~50MB - 100MB | 容器内存占用 |
| **CPU** | 低 (~10%) | 极低 (~1%) | 向量写入/搜索都很轻量 |
| **磁盘存储** | ~2-5 MB | - | 1000 个 384 维向量 + payload |
| **网络** | 内网通信 | 内网通信 | REST API，延迟 < 10ms |

**💡 建议：**
- 内存 < 4GB 的设备建议关闭向量搜索，仅使用子串匹配
- 索引完成后可以关闭 Koishi 重启，模型会从缓存加载，更快

---

### ⬇️ 手动下载模型文件（可选）

如果 Transformers.js 自动下载失败（网络问题、代理问题等），可以使用插件目录下的 Python 脚本手动下载模型文件。

**环境变量：**
| 变量 | 说明 | 示例 |
|------|------|------|
| \`HF_PROXY\` | 代理地址（优先使用） | \`socks5h://127.0.0.1:7890\` |

**运行方法：**
\`\`\`bash
# 进入插件 assets 目录
# cd /path/to/koishi-plugin-randpic/assets
本插件的实际路径：
cd ${path.resolve(__dirname, '../assets')}

# 安装依赖
pip install requests[socks]

# 直接运行（自动尝试 127.0.0.1:7890 代理）
python download.py

# 或者指定代理
HF_PROXY=socks5h://192.168.31.84:7890 python download.py

# 或者使用 http 代理
HF_PROXY=http://127.0.0.1:7890 python download.py
\`\`\`

**说明：**
- 脚本会自动下载所需的模型文件到当前目录
- 如果 \`huggingface.co\` 无法访问，会自动尝试 \`hf-mirror.com\` 镜像
- 下载完成后，确保 \`localModelDir\` 配置指向正确的 assets 目录

---

### 🐳 Qdrant 部署（推荐使用 Docker）

Qdrant 是一个高性能向量数据库，用于存储和搜索图片的 Embedding 向量。

**仓库地址：** <a href="https://github.com/qdrant/qdrant" target="_blank">https://github.com/qdrant/qdrant</a>


**快速部署：**
\`\`\`bash
docker run -d --name qdrant -p 56333:6333 -v /path/to/qdrant_data:/qdrant/storage qdrant/qdrant
\`\`\`

**说明：**
- \`-p 56333:6333\`：将宿主机的 \`56333\` 端口映射到容器的 \`6333\` 端口
- \`-v /path/to/qdrant_data:/qdrant/storage\`：持久化存储数据
  - Linux 示例：\`/home/user/qdrant_data\`
  - Windows 示例：\`D:\\qdrant_data\`（注意路径格式）

<span style="color:red">**⚠️ 重要提醒：** 如果多个 Koishi randpic 插件实例共用同一个 Qdrant 容器，必须为每个实例配置不同的 \`collectionName\`，否则会导致数据冲突和索引混乱！</span>

`
