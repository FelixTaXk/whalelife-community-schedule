# 内置服装素材

本目录包含演示服装库的索引、WebP 预览图和缩略图，保持相对路径结构。来源版本见 `SOURCE.json`，许可见 `LICENSE`，中文元数据与图集分工见 `NOTICE.md`。

- 运行时只用 `thumbs/` 与 `img/`；`png/` 是原图快照，不随商城发行包分发。
- 索引优先读插件根级 `data/catalog.json`（本地导入后生成）；商城包读本目录的 `catalog.json`。
- 上游 `paipiange/nvzhuang` 只带 `thumbs/`、`img/`；需要原图请另行保存。
