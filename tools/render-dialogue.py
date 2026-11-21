"""Bake the game's prerecorded character dialogue. FFmpeg must be on PATH.

Render Mandarin with the IndexTTS2 Python environment.
  python tools/render-dialogue.py --engine-root path/to/index-tts2 --model-dir path/to/checkpoints_2
Render Japanese with supertonic==1.3.1 and the downloaded Supertone/supertonic-3 model.
  python tools/render-dialogue.py --lang ja-JP --model-dir path/to/supertonic-3
Add --only rescue-reply or --actor xia to retake a cue or a character.
"""

import argparse
from collections import defaultdict
import hashlib
import inspect
import json
import math
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
VOICES = ROOT / 'public/assets/voices'
REFERENCES = ROOT / 'art/voice-cast'
HEROES = {'ranger': '沈孤鸿', 'xia': '陆青梧'}
CAST = {'': 'narrator', '地下联络人': 'contact'}
# Source styles are the model's anonymous presets. Mixed styles are combined
# before synthesis, so changes of pitch and timing are still part of the performance.
JAPANESE_CAST = {
    'thug':    ({'M1': 1.0}, 1.025),
    'gunman':  ({'M4': 1.0}, .985),
    'guard':   ({'M2': 1.0}, 1.0),
    'officer': ({'M3': 1.0}, 1.025),
    'gunner':  ({'M4': .53, 'M5': .47}, .98),
    'boss':    ({'M5': 1.0}, .955),
    'enemy':   ({'M2': .54, 'M4': .46}, 1.015),
    'gang':    ({'M1': .48, 'M3': .52}, 1.035),
}
JAPANESE_PACE = {'mutter': .96, 'hard': .96, 'threat': .97, 'alert': 1.015,
                 'command': 1.045, 'rush': 1.075, 'desperate': 1.08,
                 'shock': 1.065, 'plead': 1.025}
# Kana overrides resolve ambiguous readings in the source model. Audible
# acting beats belong only to the recording. The subtitle keeps its natural spelling.
JAPANESE_PRONUNCIATION = {'煙草': 'たばこ', '降参': 'こうさん'}
JAPANESE_BREATHS = {'near-idle-gunner-2': '<sigh> ', 'near-idle-thug-2': '<breath> '}

# IndexTTS2's speaker and emotion conditioning are separate. Use the same
# reference for a character in every scene and direct each take individually.
# Columns: happy, angry, sad, afraid, disgusted, melancholic, surprised, calm.
READINGS = {
    'low':       [0, .06, 0, 0, 0, .12, 0, .42],
    'alert':     [0, .11, 0, .12, 0, 0, .13, .24],
    'hush':      [0, 0, 0, .12, 0, .10, 0, .44],
    'reassure':  [.14, 0, 0, 0, 0, .06, 0, .42],
    'hard':      [0, .35, 0, 0, .10, .04, 0, .16],
    'threat':    [0, .45, 0, 0, .16, 0, 0, .09],
    'command':   [0, .30, 0, 0, 0, 0, .20, .14],
    'rush':      [0, .24, 0, .23, 0, 0, .18, 0],
    'relief':    [.28, 0, 0, .15, 0, 0, .15, .07],
    'desperate': [0, .46, .04, .17, 0, 0, .05, 0],
    'plead':     [0, 0, .13, .43, 0, 0, .10, .03],
    'shock':     [0, .09, 0, .29, 0, 0, .30, 0],
    'briefing':  [0, 0, 0, 0, 0, .12, 0, .43],
}
DIRECTION = {
    'alley-entry': 'low', 'dock-entry': 'hush', 'warehouse-entry': 'hard',
    'blade-debt': 'hard', 'blade-end': 'low', 'blade-path': 'threat',
    'quiet': 'hush', 'shot-debt': 'hard', 'shot-warning': 'low', 'shot-path': 'threat',
    'boss-challenge': 'threat', 'boss-reply': 'low', 'mag-empty': 'rush',
    'rescue-contact': 'relief', 'rescue-reply': 'reassure', 'retreat': 'rush', 'reload': 'alert',
    'spot-thug': 'shock', 'spot-gunman': 'rush', 'spot-soldier': 'alert',
    'spot-officer': 'command', 'spot-gunner': 'command', 'spot-boss': 'hard', 'spot': 'command',
    'charge': 'desperate', 'struggle': 'desperate', 'surrender': 'plead',
    'witness': 'shock', 'ally-down': 'rush', 'brief-0': 'briefing',
    'brief-1': 'briefing', 'brief-2': 'low',
    'boss-summon': 'command', 'heard-shot': 'alert',
    'near-idle': 'mutter', 'near-alert': 'command', 'near-hero': 'hush',
}
XIA_DIRECTION = {'alley-entry': 'alert', 'warehouse-entry': 'low', 'boss-reply': 'hard',
                 'near-hero-2': 'low', 'near-hero-4': 'alert'}
PREVIEW = ('ja/guard/near-idle-guard-1.mp3', 'ranger/near-hero-1.mp3',
           'ja/gunman/near-alert-gunman-1.mp3', 'xia/near-hero-2.mp3',
           'ja/officer/heard-shot-officer.mp3', 'ja/boss/boss-challenge.mp3')


def takes(lines, language):
    for cue, row in lines.items():
        if row['lang'] != language:
            continue
        line, speaker = row['line'], row['speaker']
        reading = DIRECTION[cue if cue in DIRECTION else row['group']]
        if language == 'ja-JP':
            actor = row['actor']
            yield actor, cue, line, reading, Path('ja') / actor / f'{cue}.mp3'
            continue
        variants = HEROES if speaker == 'hero' or 'xiaLine' in row or '{hero}' in line else ('cast',)
        for folder in variants:
            variant = row.get('xiaLine', line) if folder == 'xia' else line
            text = variant.format(hero=HEROES.get(folder, ''))
            actor = folder if speaker == 'hero' else CAST[speaker]
            take_reading = XIA_DIRECTION.get(cue, reading) if actor == 'xia' else reading
            spoken = text.replace('——！', '！').replace('——', '，').replace('……', '…')
            yield actor, cue, spoken, take_reading, Path(folder) / f'{cue}.mp3'


def master(source, target, reading):
    with wave.open(str(source), 'rb') as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError(f'Expected a mono 16-bit recording at {source}')
        rate = wav.getframerate()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2')
    active = np.flatnonzero(np.abs(samples.astype(np.int32)) > 100)
    if not active.size:
        raise ValueError(f'Empty recording at {source}')
    start = max(0, active[0] - round(.055 * rate))
    end = active[-1] + round(.105 * rate)
    pcm = samples[start:end].tobytes()
    ffmpeg = ['ffmpeg', '-nostdin', '-hide_banner', '-f', 's16le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0']
    measure = subprocess.run(ffmpeg + ['-af', 'highpass=f=55,loudnorm=print_format=json',
                                        '-f', 'null', '-'], input=pcm, capture_output=True, check=True)
    report = measure.stderr.decode('utf8', errors='replace')
    stats, _ = json.JSONDecoder().raw_decode(report[report.rindex('{'):])
    loudness, peak = float(stats['input_i']), float(stats['input_tp'])
    if not (math.isfinite(loudness) and math.isfinite(peak)):
        raise ValueError(f'Unmeasurable level at {source}')
    target_level = {'mutter': -19.5, 'hush': -19, 'low': -17.8, 'briefing': -18, 'rush': -16.5,
                    'command': -16.5, 'desperate': -16.5}.get(reading, -17.2)
    # A single gain change retains the breaths, accented syllables and delivery.
    gain = min(target_level - loudness, -1.8 - peak)
    subprocess.run(ffmpeg + ['-loglevel', 'error', '-y', '-af', f'highpass=f=55,volume={gain:.3f}dB',
                              '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '96k', str(target)],
                   input=pcm, check=True)


def write_preview(output):
    tracks = [output / name for name in PREVIEW]
    if not all(path.is_file() for path in tracks):
        return
    clips = [subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1',
                                      '-ar', '24000', '-f', 's16le', 'pipe:1']) for path in tracks]
    gap = bytes(round(.36 * 24000) * 2)
    with tempfile.TemporaryDirectory(dir=output) as work:
        sample = Path(work) / 'cast-preview.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ac', '1', '-ar', '24000',
                        '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '96k', str(sample)],
                       input=gap.join(clips), check=True)
        os.replace(sample, output / sample.name)


def load_mandarin(engine, weights):
    import torch

    sys.path.insert(0, str(engine))
    os.chdir(engine)
    from indextts.infer_v2 import IndexTTS2

    torch.set_num_threads(min(4, os.cpu_count() or 1))
    if torch.cuda.is_available():
        torch.set_float32_matmul_precision('high')
    options = {'use_fp16': True, 'use_cuda_kernel': False, 'use_deepspeed': False}
    if 'use_qwen_emo' in inspect.signature(IndexTTS2).parameters:
        options['use_qwen_emo'] = False
    model = IndexTTS2(model_dir=str(weights), cfg_path=str(weights / 'config.yaml'), **options)
    # This encoder is used only when switching actors. Keeping it in system RAM
    # leaves smaller graphics cards enough room for synthesis and the vocoder.
    if str(model.device).startswith('cuda'):
        model.semantic_model.cpu()
        model.semantic_mean = model.semantic_mean.cpu()
        model.semantic_std = model.semantic_std.cpu()
        encode = model.get_emb

        def encode_reference(features, mask):
            return encode(features.cpu(), mask.cpu()).to(model.device)

        model.get_emb = encode_reference
        torch.cuda.empty_cache()
    return model


def load_japanese(weights):
    from supertonic import Style, TTS

    model = TTS(model='supertonic-3', model_dir=weights, auto_download=False,
                intra_op_num_threads=min(4, os.cpu_count() or 1), inter_op_num_threads=1)
    presets = {name: model.get_voice_style(name) for name in ('M1', 'M2', 'M3', 'M4', 'M5')}
    styles = {}
    for actor, (mix, _) in JAPANESE_CAST.items():
        timbre = sum(presets[name].ttl * weight for name, weight in mix.items())
        timing = sum(presets[name].dp * weight for name, weight in mix.items())
        styles[actor] = Style(timbre, timing)
    return model, styles


def record_japanese(model, style, actor, cue, text, reading, wav):
    for kanji, kana in JAPANESE_PRONUNCIATION.items():
        text = text.replace(kanji, kana)
    text = JAPANESE_BREATHS.get(cue, '') + text
    pace = JAPANESE_CAST[actor][1] * JAPANESE_PACE[reading]
    audio, _ = model.synthesize(text, voice_style=style, lang='ja', total_steps=14, speed=pace)
    model.save_audio(audio, str(wav))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lang', choices=('zh-CN', 'ja-JP'), default='zh-CN')
    parser.add_argument('--engine-root', type=Path, help='IndexTTS2 checkout for Mandarin only')
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=VOICES)
    parser.add_argument('--only', nargs='+', help='cue IDs to render')
    parser.add_argument('--actor', choices=sorted(set(HEROES) | set(CAST.values()) | set(JAPANESE_CAST)))
    args = parser.parse_args()
    if args.lang == 'zh-CN' and args.engine_root is None:
        parser.error('--engine-root is required to record Mandarin')
    lines = json.loads((ROOT / 'src/config/dialogue.json').read_text(encoding='utf8'))
    if args.only and set(args.only) - lines.keys():
        parser.error('unknown cue: ' + ', '.join(sorted(set(args.only) - lines.keys())))
    output = args.output.resolve()
    jobs = defaultdict(list)
    for actor, cue, text, reading, path in takes(lines, args.lang):
        if (not args.actor or args.actor == actor) and (not args.only or cue in args.only):
            jobs[actor, cue, text, reading].append(output / path)
    if not jobs:
        parser.error('no recordings match this selection')
    if args.lang == 'ja-JP':
        model, styles = load_japanese(args.model_dir.resolve())
    else:
        import torch
        model = load_mandarin(args.engine_root.resolve(), args.model_dir.resolve())
    with tempfile.TemporaryDirectory(prefix='hsg-dialogue-') as work:
        wav = Path(work) / 'take.wav'
        mp3 = Path(work) / 'take.mp3'
        for (actor, cue, text, reading), outputs in sorted(jobs.items()):
            seed = int.from_bytes(hashlib.sha256(f'{actor}/{cue}/{text}'.encode()).digest()[:4], 'big')
            random.seed(seed)
            np.random.seed(seed)
            if args.lang == 'ja-JP':
                record_japanese(model, styles[actor], actor, cue, text, reading, wav)
            else:
                torch.manual_seed(seed)
                model.infer(spk_audio_prompt=str(REFERENCES / f'{actor}.flac'), text=text,
                            output_path=str(wav), emo_vector=READINGS[reading], use_random=False,
                            num_beams=2, temperature=.78, max_mel_tokens=850)
            master(wav, mp3, reading)
            for target in outputs:
                target.parent.mkdir(exist_ok=True, parents=True)
                with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as staged:
                    stage = Path(staged.name)
                try:
                    shutil.copyfile(mp3, stage)
                    os.replace(stage, target)
                finally:
                    stage.unlink(missing_ok=True)
                print(f'Baked {target.relative_to(output).as_posix()}', flush=True)
    if any(path.relative_to(output).as_posix() in PREVIEW for outputs in jobs.values() for path in outputs):
        write_preview(output)


if __name__ == '__main__':
    main()
