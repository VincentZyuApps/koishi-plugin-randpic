import path from 'node:path'

const pkg = require('../package.json')

const KOISHI_LOGO_BASE64 = 'data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAABU0lEQVR42p2UQSsFYRSGnxnqLuytKWKpKFkQNsS%2FsOHPWPADLCmxU5S7UzYWNrJR7lYiRF2FeWzOMKZ7mXHqNNP5vvP2nu%2B850CY2lP4X1K31ZbaDm%2BpO%2Bpyp5wfAXVEPfRvO1JHf4AVQGbUh7j4EZ4VkrNCXPVRnf3CUBN1SH2KC28VGOV3ntRhNclZHdcAKYM11QR1oVBOXctzFlNgBTC8qmXxPQEegbVeYApIgJT6tg%2F0AdMp0B%2FBpCabK2AAmAAa%2F2GRBft1oBFPkqTAba7LCiAfQC9wClwAY1HJHepuiO29Yrsf1Dn1uiDU3RTYCtTkl1Leg8k9MB4NGgReI28rV3azgyCz0og01Xl1Uz1QX8uCTELm3UbkTF1VJ9Wr0tn3iBSGdjYG0XivE3VN3VD31PM4a3cc2tIGGI0VkTO7rLxGuiy25ejmjfqsvkSXui62TxaK03td4FXTAAAAAElFTkSuQmCC'

export const usage = `
<h1>Koishi 插件：Randpic 智能随机图片</h1>
<h2>🎯 插件版本：v${pkg.version}</h2>

<p>
  <a href="https://www.npmjs.com/package/koishi-plugin-randpic" target="_blank">
    <img src="https://img.shields.io/npm/v/koishi-plugin-randpic?style=flat-square&logo=npm" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/koishi-plugin-randpic" target="_blank">
    <img src="https://img.shields.io/npm/dm/koishi-plugin-randpic?style=flat-square&logo=npm" alt="npm downloads">
  </a>
  <br>
  <a href="https://github.com/VincentZyuApps/koishi-plugin-randpic" target="_blank">
    <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="https://gitee.com/vincent-zyu/koishi-plugin-randpic" target="_blank">
    <img src="https://img.shields.io/badge/Gitee-C71D23?style=for-the-badge&logo=gitee&logoColor=white" alt="Gitee">
  </a>
  <br>
  <a href="https://koishi.chat/zh-CN/market/" target="_blank">
    <img src="https://img.shields.io/badge/Koishi-Plugin-5546A3?style=for-the-badge&logo=${KOISHI_LOGO_BASE64}&logoColor=white" alt="Koishi Plugin">
  </a>
  <a href="https://qm.qq.com/q/ZN7fxZ3qCq" target="_blank">
    <img src="https://img.shields.io/badge/QQ群-1085190201-12B7F5?style=flat-square&logo=qq&logoColor=white" alt="QQ群">
  </a>
  <br>
</p>

<h2>💬 交流反馈</h2>
<p>🐛 Bug 反馈 / 💡 建议 / 👨‍💻 插件开发交流，欢迎加群：</p>
<p><del>💬 插件使用问题 / 🐛 Bug反馈 / 👨‍💻 插件开发交流，欢迎加入QQ群：<b>259248174</b>   🎉（这个群G了）</del></p>
<p>💬 插件使用问题 / 🐛 Bug反馈 / 👨‍💻 插件开发交流，欢迎加入QQ群：<b>1085190201</b> 🎉</p>
<p>💡 在群里直接艾特我，回复的更快哦~ ✨</p>

<hr>

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

启用自动刷新图片缓存后，新增、删除和重命名的图片会在缓存过期后的下一条命令中自动生效；子串匹配未命中时会立即刷新一次目录。

<details>
<summary><h3>👁️ Ollama 视觉增强（点击展开）</h3></summary>

启用 Ollama 视觉模型后，索引时会使用多模态 AI（如 moondream、LLaVA 等）分析图片内容，生成描述性 tag。
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

</details>

<details>
<summary><h3>🧪 向量搜索架构与资源占用（点击展开）</h3></summary>

#### 技术架构

本插件使用两个核心依赖实现向量搜索：

| 依赖 | 作用 | 说明 |
|------|------|------|
| \`@xenova/transformers\` | **生成向量** | Transformers.js，在 Node.js 本地运行 AI 模型，将文件名文本转换为 384 维向量 |
| \`@qdrant/js-client-rest\` | **存储 & 搜索向量** | Qdrant 向量数据库的 REST 客户端，用于高效存储和相似度搜索 |

**工作流程：**
1. \`randpic.index\` 扫描图片 → Transformers.js 生成向量 → 存入 Qdrant
2. \`randpic 关键词\` 搜索时 → Transformers.js 将关键词转向量 → Qdrant 查找最相似的图片

#### 资源占用估算（约 1000 张图片）

**Transformers.js（本地 Embedding 模型）**

| 资源 | 首次索引 | 运行时搜索 | 说明 |
|------|----------|------------|------|
| **内存 (RAM)** | ~500MB - 800MB | ~400MB - 600MB | 模型常驻内存 |
| **CPU** | 高 (100%) | 低 (~5-10%) | 索引时密集计算，搜索时仅单次推理 |
| **索引耗时** | ~8-12 秒 | - | i5-10210U 约 8 秒生成 1000 个向量 |
| **模型缓存** | ~100MB | - | 首次下载后缓存到 ~/.cache |

**Qdrant（向量数据库 Docker 容器）**

| 资源 | 索引写入 | 运行时搜索 | 说明 |
|------|----------|------------|------|
| **内存 (RAM)** | ~100MB - 200MB | ~50MB - 100MB | 容器内存占用 |
| **CPU** | 低 (~10%) | 极低 (~1%) | 向量写入/搜索都很轻量 |
| **磁盘存储** | ~2-5 MB | - | 1000 个 384 维向量 + payload |
| **网络** | 内网通信 | 内网通信 | REST API，延迟 < 10ms |

**💡 建议：**
- 内存 < 4GB 的设备建议关闭向量搜索，仅使用子串匹配
- 索引完成后可以关闭 Koishi 重启，模型会从缓存加载，更快

</details>

<details>
<summary><h3>⬇️ 手动下载模型文件（点击展开）</h3></summary>

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

</details>

<details>
<summary><h3>🐳 Qdrant 部署（点击展开）</h3></summary>

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

</details>
`
