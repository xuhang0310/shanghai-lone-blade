# Mixamo 动画放这里

从 [Mixamo 的 Animations](https://www.mixamo.com/#/?type=Motion%2CMotionPack) 下载 FBX 或动作包，把文件放到这里。在项目根目录运行

```
npm run anims
```

刷新游戏，开发模式下主菜单或暂停菜单里的「动作库」可以用沈孤鸿、陆青梧和士兵逐个试演。选「官网动作包」可以看每包的动作数和官方预览，选「官网目录」可以搜索名称、切换同名版本。官网动图需要联网。

`npm run anims` 在转换 `anim-src/` 内真实 Mixamo 动作后，会自动运行 `tools/fill-missing-motions.mjs`：对尚未放入真实 FBX 的缺口动作（`ProneLeftTurn`、`HitBody`、`DeathBack`、`Surrender`、`KneelHit`）补入带`（合成）`/`（镜像）`标记的占位动作；一旦向 `anim-src/` 补入对应的真实 Mixamo FBX 并重新运行 `npm run anims`，真实动作会自动覆盖对应合成占位。

ZIP 可以直接放在这里。已解压的包可以保留子目录和默认文件名。转换时会读取每个文件中的所有人体动画片段，同类同动作的副本会合并。两套游戏骨骼共用动作目录，额外试演动作按需读取。原始下载只存放在本地。

## 下载设置

在 Mixamo 选好动画后点 Download：

- Format：**FBX Binary (.fbx)**
- Skin：**With Skin**
- Frames per Second：**30**
- Keyframe Reduction：**none**
- 走路、爬行这类动画页面上有 **In Place** 选项，记得勾上
- 角色用默认的 Y Bot 即可，换别的 Mixamo 角色也行

游戏按文件名和动作片段名匹配下表用途。其他动作也能在「已装入游戏」里试演。

## 需要的动画（Mixamo 里搜这些词，挑最接近的）

| 游戏里的用途 | 搜索词 | 识别规则（文件名里包含） |
|---|---|---|
| 爆头受击 | Head Hit | head + hit |
| 身体受击 | Hit Reaction | hit / reaction |
| 腹部受击 | Stomach Hit | stomach |
| 中弹后仰倒地 | Falling Back Death | death / dying（通用死亡） |
| 中弹向前扑倒 | Falling Forward Death | death + forward |
| 爆头倒地 | Headshot / Death From Front Headshot | headshot |
| 腿伤瘸行（勾 In Place） | Injured Walk | injured + walk |
| 重伤爬行（勾 In Place） | Crawl / Crawling | crawl |
| 举手投降（选站着的） | Surrender | surrender |
| 腿中弹跪地（可选） | Kneeling | kneel |
| 站定后转身、蹲下转向 | Turn Left / Turn Right | 角色站立时使用脚步，蹲下时可使用相应低姿动作 |
| 趴姿转向 | Prone Right Turn / Prone Left Turn | 根据实际转向短暂切换到该动作，结束后继续爬行 |
| 行走、奔跑、站立 | Walking / Running / Idle | 普通前进步态和待机动作可直接替换对应的基础步态 |

官网的 Action Adventure Pack、Male Locomotion Pack 和 Female Locomotion Pack 可以整包导入。官网目录展示的是名称，逐帧骨骼数据来自下载的文件。
