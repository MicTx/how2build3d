# 贡献指南 · Contributing

文档、可独立运行的场景修复和能证明问题的最小示例都欢迎。先选最接近的 `examples/` 场景，不必为了一个材质问题构建整套玩法。

## 复现与验证 · Reproduce and verify

1. 从仓库根运行 `npm ci --prefix harness`。报告问题时写明示例、命令、seed、浏览器及预期和实际结果。请裁掉截图中的个人信息，不要上传整份运行日志。
2. 修改场景后，构建并打开对应单文件 HTML。画面改动尽量附同一机位的前后帧；性能结论请注明画质档、设备和实际计数。
3. 文档改动跑 `node harness/gates/doc.mjs --all-tracked`；构建和浏览器检查见 [README](README.md#验证)。有完整研究夹具时再跑 `node harness/verify.mjs --static`。不要提交依赖、构建目录或原始研究夹具。

For a public contribution, open a pull request with the smallest change that demonstrates the fix. Record the command you ran, the result, and any checks you could not run. If the change alters a scene, use the same camera, seed and quality tier for both images. Preserve attribution for anything you port; do not contribute material you cannot distribute under the applicable terms.

一般问题可用 [GitHub Issues](https://github.com/MicTx/how2build3d/issues)。参与讨论请遵守[行为准则](CODE_OF_CONDUCT.md)；安全问题见 [SECURITY.md](SECURITY.md)。
