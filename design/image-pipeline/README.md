---
status: adopted
reviewed: 2026-08-22
---

# Per-project image pipeline

**His rule, 2026-08-22:** *"We aren't stealing their creative skills. We're copying the workflow.
Each app will have its own image pipeline based on its theme and not just an image pipeline."*

So: one graph **per project**, living at **`<project>/design/image-pipeline.json`**, next to
`<project>/design/theme.md`. Two themes = two graphs, not two prompts into one graph. The graph
is the theme's look made executable — model, style block, sampler, resolution, seed, and any
post chain that theme needs.

## What we copied, and from whom

| Taken | From | Note |
|---|---|---|
| ComfyUI **API-format** graph as the unit of image production | ComfyUI (GPL-3.0) | node-id → `{class_type, inputs}`; links are `["<node_id>", <output_index>]` |
| The Flux dev graph shape | Hermes `creative/comfyui` skill (MIT), `workflows/flux_dev_txt2img.json` | `UNETLoader → BasicGuider → SamplerCustomAdvanced → VAEDecode → SaveImage` |
| The runner + cloud routing | Hermes `creative/comfyui` `scripts/run_workflow.py`, `_common.py` | we **call** it, we do not fork it |
| local-vs-cloud hardware routing | `scripts/hardware_check.py` | his M5 Pro / 24 GB measured `marginal`: *"SDXL works but slow. Flux/video likely too tight"* |

Not taken: their creative skills / prompts / house style. That is their art direction; using it
would make our themes look like theirs.

## Model and runtime — MEASURED 2026-08-22, not estimated

**FLUX.1-schnell runs locally on his M5 Pro / 24 GB. It is free, needs no account, no API key
and no network at render time.** The earlier "Comfy Cloud is the default lane, local is too
tight" line was an *estimate from a hardware-check script*, and it was wrong. Comfy Cloud is no
longer required and `COMFY_CLOUD_API_KEY` is not a blocker for anything.

| Fact | Value | How known |
|---|---|---|
| Runner | `mflux` (MLX), `mflux-generate` | installed, on PATH |
| Model | **`madroid/flux.1-schnell-mflux-4bit`** — Apache-2.0, **ungated** | rendered |
| Speed | **14 s** for 4 steps at 512² | measured |
| Peak memory | **10.39 GB** at 512², 14.61 GB at 768×1344 | reported by mflux |
| Licence | Apache-2.0 (schnell), commercial use allowed | HF model card |

```sh
uv tool install --upgrade mflux --prerelease=allow --with "tokenizers==0.22.1"
```

The `tokenizers` pin matters: mflux shipped `tokenizers==0.23.0-rc0`, which breaks
`CLIPTokenizer` with `RobertaProcessing.__new__() got an unexpected keyword argument 'cls'`.

### The failure mode that cost a night — read this before switching mirrors

BFL's own `black-forest-labs/FLUX.1-schnell` is **gated: auto**, so the first attempt used the
ungated **fp8** mirror `John6666/flux1-schnell-fp8-flux` (17 GB). It downloaded, loaded, and ran
all 4 steps to completion with no error and no warning — and wrote a **valid, decodable, 6,935-byte
PNG that was pure black**. The fp8 weights go NaN on this path. Verified it was the weights and
not the flags: still black with `--quantize` removed, with `--low-ram` removed, and at a
different resolution.

Two consequences, both now permanent:

1. **Use the 4-bit mflux-format mirror, not an fp8 one.** `madroid/flux.1-schnell-mflux-4bit` is
   saved in mflux's own layout (numbered shards, both tokenizers included) and needs no
   `--quantize` flag. Pass it to **`--model`**; this mflux build has no `--path` argument.
2. **A file-size check cannot catch this.** Inspect the generated image before adopting it. A
   decodable file can still be a failed render, so visual review is required.

SDXL only if a project trades fidelity for speed, and that trade is recorded in `theme.md`.

## Authoring a project's graph

1. Copy `template.flux.json` → `<project>/design/image-pipeline.json`.
2. Put **the theme's locked style block** in node `6`'s `text`, and the project name in node
   `9`'s `filename_prefix`.
3. Set node `25`'s `noise_seed` to the theme's **locked seed** and node `27`'s `width`/`height`
   to that theme's working aspect.
4. Tune `steps`/`scheduler`/`sampler_name` for the look, then stop touching them — drift there
   is drift in the theme.
5. Record all of it in `<project>/design/theme.md`. The graph is the executable copy; `theme.md`
   is the readable one.

**No non-node keys at the top level.** Hermes' shipped `flux_dev_txt2img.json` carries a
top-level `_comment` string that `run_workflow.py:174` POSTs to the server unstripped, and any
loop that does `v.get("class_type")` without a type check crashes on it. Our graphs stay pure
node maps; commentary lives in `theme.md`.

## Running it — the local lane (default)

```sh
mflux-generate \
  --model madroid/flux.1-schnell-mflux-4bit --base-model schnell \
  --steps 4 --seed <locked seed> --height 768 --width 1344 \
  --output <project>/design/assets/<theme>/<theme>-NN.png \
  --prompt "<subject>, <locked style block>"
```

Then inspect the output before adopting it; a render command succeeding is not proof that the
image is usable.

### The cloud lane (only if a project outgrows local)

```sh
python3 ~/.hermes/hermes-agent/skills/creative/comfyui/scripts/run_workflow.py \
  --workflow <project>/design/image-pipeline.json \
  --args '{"prompt": "<subject>, <locked style block>", "seed": <locked seed>}' \
  --output-dir <project>/design/assets \
  --host https://cloud.comfy.org
```

Injectable parameter names the auto-schema exposes for this graph:
`prompt · filename_prefix · vae_name · clip_name1 · clip_name2 · unet_name · sampler_name ·
steps · scheduler · denoise · seed · width · height · batch_size`.

**Never pass a bare subject as `prompt`.** `prompt` replaces node 6's text wholesale, so a bare
subject silently drops the theme. Always compose `<subject>, <locked style block>`. The style
block is committed as the graph's default text, so any drift shows up in `git diff`.

## The rules this exists to enforce

- A theme concept is **not presentable until it has generated imagery** (`PIPELINE.md` §4.5).
- The **palette is extracted from the imagery**, not invented in code
  (`sources/audience-identity-motion-video.md`).
- Generated stills are only half of it — the theme also owes the authored motion assets in
  `entries/interactive-elements-and-load.md` (Lottie logo + section motifs, parallax planes,
  brand-line strokes, cursors).
