# kumoya - 云谷
似人打包器，yakumo 的部分功能代替版，但更加专注于打包和构建代码而不是嵌套工作区管理

## 支持功能

[x] 子工作区构建
[x] 原生 esbuild 配置兼容
[x] 类型声明文件打包
[x] 子工作区包发布

## 使用

```bash
yarn add kumoya
```

```bash
yarn kumoya init
yarn kumoya build <workspace>
yarn kumoya publish <workspace>
```

## 特别鸣谢

[yakumo](https://github.com/cordiverse/yakumo)