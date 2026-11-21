# 沪上孤枪配音

沈孤鸿、陆青梧、地下联络人和任务旁白使用普通话。虚构的日本帮众与守卫使用日语。游戏直接播放本地 MP3。[配音试听](../../public/assets/voices/cast-preview.mp3)

试听依次收录卫兵等候换班、沈孤鸿听见动静、枪手拦人、陆青梧低声回应、警备队长追问枪声，以及黑龙现身。

## 普通话

每个 FLAC 是一名角色的合成声线底样。底样使用 Kokoro 中文 v1.1 的 sherpa-onnx 多语音色包，语速为 1.0。原句是“雨刚停。你听，远处还有人说话。天一亮，我们就动身。” 成品由 IndexTTS2 按每句的情绪设定离线生成。[Kokoro 中文模型](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) · [sherpa-onnx 模型包](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models) · [IndexTTS2](https://huggingface.co/IndexTeam/IndexTTS-2)

| 当前角色 | 底样 | 包内音色编号 |
| --- | --- | ---: |
| 沈孤鸿 | ranger | 60 |
| 陆青梧 | xia | 17 |
| 地下联络人 | contact | 86 |
| 任务旁白 | narrator | 9 |

该目录也保存了早期普通话选角时的底样。对应音色编号为 boss 71、officer 93、guard 74、gunner 79、gunman 73、thug 99、gang 95、enemy 92。

## 日语

日语对白使用 Supertonic 3 的日语模式，在本地生成。八个角色各有固定声线。三种混合音色在合成之前组合模型自带的声线参数。等候换班的低语、突然撞见主角时的喝问和同伴倒下时的呼喊分别控制语速和响度。模型采用 Open RAIL-M 许可，游戏随包提供的是成品录音。[Supertonic 3 模型及音色](https://huggingface.co/Supertone/supertonic-3) · [模型许可](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE)

| 游戏角色 | 录音目录 | 模型音色 |
| --- | --- | --- |
| 黒龍の用心棒 | ja/thug | M1 |
| 黒龍の拳銃使い | ja/gunman | M4 |
| 埠頭の衛兵 | ja/guard | M2 |
| 警備隊長 | ja/officer | M3 |
| 機関銃手 | ja/gunner | M4 53% + M5 47% |
| 黒龍 | ja/boss | M5 |
| 見張り | ja/enemy | M2 54% + M4 46% |
| 黒龍の子分 | ja/gang | M1 48% + M3 52% |

## 重录

字幕和台词在 `src/config/dialogue.json`。下列命令在项目根目录运行，需要 FFmpeg。日语生成环境安装 `supertonic==1.3.1`，模型目录包含 `onnx/` 和 `voice_styles/`。[配音脚本](../../tools/render-dialogue.py)

```shell
python tools/render-dialogue.py --lang ja-JP --model-dir path/to/supertonic-3 --only near-idle-guard-1
python tools/render-dialogue.py --lang zh-CN --engine-root path/to/index-tts2 --model-dir path/to/checkpoints_2 --only near-hero-1
```

省略 `--only` 可重录所选语言的全部台词，也可以用 `--actor xia` 或 `--actor officer` 指定角色。成品按角色保存在 `public/assets/voices`。重录试听中的任意一句后，脚本会按照同样的顺序重新混制试听。
