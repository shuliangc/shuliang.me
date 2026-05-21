# shuliang.me

曹书良 - 前端开发工程师个人简历站点。

在线访问：<https://shuliang.me>

## 项目结构

```
.
├── 曹书良-前端开发工程师.md   # 简历 Markdown 源文件（单一数据源）
├── sync.js                  # md → html 同步脚本
├── www/
│   ├── index.html           # 由 sync.js 自动生成的静态页面
│   └── CNAME                # GitHub Pages 自定义域名
└── .github/workflows/
    └── sync.yml             # md push 后自动同步 html 的 CI
```

## 本地开发

```bash
npm install
npm run sync       # 单次同步
npm run watch      # 监听 md 变化自动同步
npm run rebuild    # 强制完整重建 html
```

## 自动化流程

```
编辑 .md → git push → GitHub Actions 执行 sync.js → 自动 commit www/index.html
                                                          ↓
                                                   GitHub Pages 部署
                                                          ↓
                                                   https://shuliang.me
```

只需修改 Markdown 文件并 `git push`，剩下的同步、构建、部署全部自动完成。

## 部署

由 GitHub Pages 托管，通过 GitHub Actions 直接将 `www/` 目录作为构建产物部署（Source: GitHub Actions），自定义域名 `shuliang.me`。

## License

仅供个人简历展示使用。
