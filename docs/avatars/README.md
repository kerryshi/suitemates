# Persona avatars

Frutiger Aero look, matching the HackNC 2026 theme. `<persona>.png` is the contact photo; `<persona>-icon.png` is the glass-orb icon for the Devpost page and slides.

AI-generated during HackNC (Sat Oct 10) with **Z-Image-Turbo** (Tongyi-MAI, Apache-2.0), run locally on Kerry's RTX 5070: 1024×1024, 9 steps, guidance 0, seed 22, downscaled to 512×512. Kerry picked seed 22 from three seeds per image. Each prompt below is the style template with the persona's description and background filled in.

## Contact photos (`<persona>.png`)

**Dean (academic)**

> Frutiger Aero style 3D rendered character avatar, glossy and soft, Windows Vista era aesthetic. Head-and-shoulders portrait of a calm, organized college senior, a young man in his early twenties with neat short dark hair, thin round glasses, a navy cardigan over a light blue collared shirt, holding a glossy translucent aqua notebook, gentle reassuring smile, centered, facing the viewer. Background: a clear Carolina blue sky with soft white clouds, translucent water bubbles, soft lens flare, glossy reflections, clean optimistic late-2000s tech aesthetic, bright sky blue and fresh green palette. Smooth stylized shading, soft glow, rim light. Square profile picture composition, face in the middle of the frame, uncluttered edges. No text, no letters, no logos, no watermark.

**Penny (financial)**

> Frutiger Aero style 3D rendered character avatar, glossy and soft, Windows Vista era aesthetic. Head-and-shoulders portrait of a playful, witty young woman in her early twenties with a high ponytail and a mint green hoodie, one eyebrow raised in a teasing smirk, a shiny glossy gold coin floating beside her, centered, facing the viewer. Background: rolling bright green grass hills under a blue sky, glossy green leaves and sparkles, translucent water bubbles, soft lens flare, glossy reflections, clean optimistic late-2000s tech aesthetic, bright sky blue and fresh green palette. Smooth stylized shading, soft glow, rim light. Square profile picture composition, face in the middle of the frame, uncluttered edges. No text, no letters, no logos, no watermark.

**Sunny (social)**

> Frutiger Aero style 3D rendered character avatar, glossy and soft, Windows Vista era aesthetic. Head-and-shoulders portrait of an upbeat, energetic young man in his early twenties with curly hair and a big warm grin, waving one hand, wearing a bright sunshine yellow zip jacket, centered, facing the viewer. Background: a bright sunny sky with a glowing sun, turquoise water and sparkles, translucent water bubbles, soft lens flare, glossy reflections, clean optimistic late-2000s tech aesthetic, bright sky blue and fresh green palette. Smooth stylized shading, soft glow, rim light. Square profile picture composition, face in the middle of the frame, uncluttered edges. No text, no letters, no logos, no watermark.

## Icons (`<persona>-icon.png`)

**Dean (academic)**

> Frutiger Aero style glossy icon, a shiny translucent glass orb in aqua and Carolina blue with a white open book and a small graduation cap floating inside, water droplets and small bubbles around it, bright white highlight reflection across the top of the orb, soft drop shadow, clean white-to-sky-blue gradient background with soft clouds, Windows Vista Aqua aesthetic, polished 3D render, centered, square composition. No text, no letters, no logos, no watermark.

**Penny (financial)**

> Frutiger Aero style glossy icon, a shiny translucent glass orb in emerald and lime green with a shiny gold coin and a small sprouting green leaf floating inside, water droplets and small bubbles around it, bright white highlight reflection across the top of the orb, soft drop shadow, clean white-to-fresh-green gradient background with a hint of grass, Windows Vista Aqua aesthetic, polished 3D render, centered, square composition. No text, no letters, no logos, no watermark.

**Sunny (social)**

> Frutiger Aero style glossy icon, a shiny translucent glass orb in sunshine yellow and warm orange with a smiling cartoon sun and sparkles floating inside, water droplets and small bubbles around it, bright white highlight reflection across the top of the orb, soft drop shadow, clean white-to-sky-blue gradient background with a soft sun glow, Windows Vista Aqua aesthetic, polished 3D render, centered, square composition. No text, no letters, no logos, no watermark.

The generation script and prompt file are in `generation/` (`gen_avatars.py`, `prompts.json`). The desktop run produced all 18 candidates (3 personas × 2 styles × seeds 11/22/33) between 16:29 and 16:33 EDT on Sat Oct 10. The render settings (bf16 weights with fp8 casting, CPU offload, 9 steps, guidance 0) reuse the Z-Image configuration from Kerry's Oct 3 local benchmark. Like the model weights, that is tool configuration; the script, prompts and images were all made during the event.
