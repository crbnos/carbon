# Factory OS 三系统品牌统一设计

## 目标

统一 Factory OS 主系统、ERPNext 与 Carbon MES 的用户可见品牌，使三个系统看起来属于同一产品家族，同时保留各自内部技术名称、依赖关系和升级路径。

## 正式名称

- 主系统：`Factory OS X`
- ERPNext：`Factory OS ERP`
- Carbon MES：`Factory OS MES`

## 统一标识

三个系统统一使用大写字母 `F` 作为主标识：

- 主色：`#00B8FF`
- 标识底：青色方形
- 字母颜色：`#09212A`
- 形状：与现有 Factory OS 品牌块一致的适度圆角
- 字重：粗体，保证小尺寸辨识度
- 留白：各边保持一致安全区，禁止拉伸或改变比例
- 变体：提供明亮背景、深色背景及单色 favicon 适配版本

系统身份由标识旁的正式名称区分，不为 ERP 或 MES 另造字母图标。

## 实施范围

### Factory OS X

- 应用侧边栏或主导航品牌区
- 现有登录或入口页面
- HTML 页面标题与描述
- 现有 favicon、Apple Touch Icon 和 PWA 图标
- 图片的替代文本和可访问名称

### Factory OS ERP

- ERPNext Factory OS 主题的导航栏品牌区
- ERPNext 登录页名称与标识
- 网站标题、favicon 与应用图标
- 主题预览中的品牌示例
- 用户可见的旧名称

不修改 ERPNext/Frappe 内部包名、DocType、路由、数据库结构或升级标识。

### Factory OS MES

- 登录页 Carbon 图形替换为统一 `F` 标识
- 页面标题由 `Carbon | MES` 调整为 `Factory OS MES`
- favicon、Apple Touch Icon 与 PWA 多尺寸图标
- 应用内可见品牌区和替代文本
- 用户可见的旧 Carbon 品牌文字

不修改 Carbon 内部包名、环境变量、API、数据库、认证流程或业务逻辑。

## 资产策略

建立一套源品牌资产作为规范源，再按三个技术栈需要导出 SVG 与 PNG 尺寸。各系统保存自己的构建资产副本，避免引入跨仓库运行时依赖。文件名采用 `factory-os-mark-*` 和 `factory-os-wordmark-*`，不以新内容覆盖仍叫 `carbon-*` 的文件。

## 兼容与边界

- 不改变现有页面布局、导航结构、颜色主题和业务交互。
- 不改第三方产品的内部标识，避免影响升级和诊断。
- 品牌替换仅作用于用户可见层和静态资产。
- 所有图标必须在浅色、深色和浏览器小尺寸下清晰。
- 保留现有未提交修改，不顺带重构相邻代码。

## 验收标准

1. 三个系统分别显示 `Factory OS X`、`Factory OS ERP`、`Factory OS MES`。
2. 三个系统的主图标均为同一青色方形 `F` 标识。
3. 登录页、主导航、浏览器标题和 favicon 不再出现不一致的用户可见旧品牌。
4. 浅色与深色主题下标识均清晰，替代文本正确。
5. Factory OS X 构建与现有测试通过。
6. ERPNext 主题资产和预览可加载，核心页面无布局回归。
7. Carbon MES 构建、类型检查及登录页/MES 主页面验证通过。
8. Carbon、ERPNext/Frappe 的内部包名、路由、API 和数据库保持不变。

## 验证方式

- 搜索三个目标代码区的用户可见旧名称和旧 Logo 引用。
- 分别运行各项目已有的针对性构建、类型检查或测试。
- 以浏览器检查三个系统的登录页、应用主界面、页面标题和 favicon。
- 在浅色与深色主题下进行桌面尺寸视觉核对。
