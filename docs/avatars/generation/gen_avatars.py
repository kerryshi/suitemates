"""Suitemates persona avatars (HackNC 2026). Z-Image-Turbo, recipe from edge-bench-2026-10-03 (A.recipe.json):
bf16 local copy, transformer fp8 layerwise casting, model CPU offload, 9 steps, guidance 0."""
import json, os, sys, time
import torch
from PIL import Image, PngImagePlugin

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "images")
MODEL = "C:/Users/PC/models/z-image-turbo-bf16"
os.makedirs(OUT, exist_ok=True)
cfg = json.load(open(os.path.join(HERE, "prompts.json"), encoding="utf-8"))

from diffusers import ZImagePipeline
t0 = time.perf_counter()
pipe = ZImagePipeline.from_pretrained(MODEL, torch_dtype=torch.bfloat16)
pipe.transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16)
pipe.enable_model_cpu_offload()
print(f"loaded in {time.perf_counter() - t0:.1f}s", flush=True)

for pid, styles in cfg["personas"].items():
    for style, fill in styles.items():
        prompt = cfg["styles"][style].format(**fill)
        for seed in cfg["seeds"]:
            name = f"{pid}_{style}_s{seed}.png"
            path = os.path.join(OUT, name)
            if os.path.exists(path):
                continue
            t = time.perf_counter()
            img = pipe(prompt=prompt, height=1024, width=1024, num_inference_steps=9, guidance_scale=0.0,
                       generator=torch.Generator("cuda").manual_seed(seed)).images[0]
            meta = PngImagePlugin.PngInfo()
            meta.add_text("ai_generated", "Z-Image-Turbo (Tongyi-MAI, Apache-2.0), local RTX 5070")
            meta.add_text("prompt", prompt)
            meta.add_text("seed", str(seed))
            img.save(path, pnginfo=meta)
            print(f"{name} {time.perf_counter() - t:.1f}s", flush=True)
print("DONE", flush=True)
