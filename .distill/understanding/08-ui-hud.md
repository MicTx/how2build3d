# 08 · UI 与 HUD：设计系统、触屏与无障碍

> CSS 层只有 三十一点五 KB / 340 行 [src:pretty:L3062-L3086]，却承载了完整 HUD、菜单、触屏布局。
> 组织方式本身就是方法论：**分区注释即目录**。

## 设计 token

`:root` 层 十七 个语义变量一次定义全站观感 [src:L11-L23]：

- **色板**：墨色双阶 `--ink/--ink-2`、骨色三阶 `--bone/--bone-dim/--bone-faint`、信号色 `--signal`（琥珀）、锈色 `--rust`、钢色 `--steel`、警报 `--alarm`——全部来自"港区标识牌 + 电影片头卡"这一个美术方向（文件头注释原文："port-authority signage meets a film title card" [src:L8-L10]）。
- **字体**：三个层级 `--f-display`（900 字重标题）/`--f-label`（正文标签）/`--f-mono`（数字），全部落到系统中文字体栈（PingFang SC → Microsoft YaHei → Noto Sans CJK SC），**零外部字体**。
- **环境适配**：`--sat/--sab/--sal/--sar` 四向安全区 + `--gl/--gr`（`max(16px, safe-area)`）页边距——刘海屏与圆角屏的内容保护区是一等公民 [src:L19-L21]。
- `color-scheme: dark` 与 `--shadow` 双层投影（贴纸感 + 大范围落影）收尾 [src:L12-L22]。

## HUD 分层

HUD 组件按"何时可见"分层，每层一个 CSS 分区注释 [src:L41-L48]：

- **罗盘带**：`h-tape` 宽 2168px 的刻度带（`will-change: transform`，纯 transform 滚动），主/次/微三种刻度线高度 10/7/4px，方位角用卡片体（N/E/S/W）、图标体、数字体三种混排；两端用 mask 渐隐 [src:L48-L58]。任务标记 `h-cm` 挂在罗盘下沿（世界坐标投影），屏幕外目标贴边半透明 `edge` 态 [src:L59-L66]。
- **目标追踪器 / 波次警告 / 交互提示 / 击杀播报**各一个分区 [src:L67-L125]；**血条只在受伤时出现**（"health (only while hurt)" [src:L125-L125]）——不打扰是 HUD 的第一原则。
- **世界空间目标菱形**与屏幕空间标记双轨 [src:L151-L151]。

动效遵循 `prefers-reduced-motion`（文件头声明的 "motion preferences" 分区 [src:L10-L10]），HUD 淡入统一 `.35s ease`。

## 触屏与无障碍

**触屏布局的原则写在注释里**："keep the thumbs' corners clear"——左拇指摇杆区、右拇指转向区，屏幕按钮（开火/瞄准/换弹/跳）放在两拇指自然落点的空档 [src:L186-L188]。按钮语义与键鼠一一对应，`touch-action: none` 全局禁用浏览器手势 [src:L28-L28]。

无障碍细节：交互提示带 `aria` 属性；设置面板的开关用 `aria-pressed` 与 `labelledby` 关联 [src:L6214-L6215]；`#view` canvas 带 `tabindex="0"` 可聚焦 [src:L351-L351]；文字对比度由三阶骨色保障（`--bone-dim` 仍有 0.64 alpha 的前景强度）[src:L13-L13]。

## 中文排版

"Chinese typography and title proportions" 有专门分区 [src:L339-L339]：标题字距 `letter-spacing:.16em` + 负 `margin-right` 补偿（避免最后一个字的字距撑宽居中块）；全大写英文标签配 `.18em~.26em` 字距——中英混排的字距纪律贯穿 HUD。

## UI 即代码

HUD 的 DOM 不在 HTML 里（那只有两行 [src:L351-L352]），全部由 JS 模板字符串生成（设置面板整段 HTML 内联在 L6202 巨行 [src:pretty:L51928-L51952]）。这套做法的好处：UI 状态与游戏状态同源更新（`setRelays` 直改 DOM [src:L6087-L6087]），且省掉了模板引擎——**三十一点五 KB CSS + JS 字符串模板 = 完整界面**。

## 给建设者的 UI 清单

照抄这套体系时的核对项：

1. token 先行：色板/字体/安全区/阴影全部进 `:root`，组件零硬编码色值 [src:L11-L23]；
2. 分区注释即目录：每个组件块以 `/* name */` 开头，维护者按注释导航 [src:L41-L48]；
3. HUD 按可见性分层：常驻（罗盘/弹药）→ 事件驱动（血条/击杀/提示）→ 模态（菜单）[src:L67-L125]；
4. 性能敏感动画只用 `transform/opacity`（罗盘带 `will-change: transform`）[src:L52-L52]；
5. 触屏布局从拇指解剖学出发，而非缩放键鼠 UI [src:L186-L188]；
6. 无障碍语义（aria-pressed/labelledby/tabindex）与 UI 同步交付 [src:L6214-L6215] [src:L351-L351]；
7. 中英混排字距成对出现（正字距 + 负 margin 补偿）[src:L339-L339]。
