# Wood grain maps

The grain of the wood boards (Phase 2 UI polish design, section 3). Each map is made from one
photograph by `scripts/wood-maps.mjs` on 2026-11-25:

- only the photo's luminance is kept, as a z-score stored as grey `128 + 32 z` (clipped to ±4);
- the grain is turned to run top to bottom, and the middle 70% is kept, so no edge of the photo shows;
- the result is scaled to 1024 × 1024 and saved as JPEG at quality 80.

The board's colour and the grain's contrast come from `src/board/styles.ts`; the app renormalises
each map when it loads it, so the stored scale only sets the precision.

All three photographs are from [Poly Haven](https://polyhaven.com) and are dedicated to the public
domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No attribution is
required; it is recorded here to keep the provenance.

| Map | Asset | File (2k diffuse) | SHA-256 |
|---|---|---|---|
| `honey.jpg` | [Okoume Veneer](https://polyhaven.com/a/okoume_veneer) | `okoume_veneer_diff_2k.jpg` | `c89231023b37d6fde0b82087eaf8c61b04a2fc82558348fd6091dba4bb9aa463` |
| `kaya.jpg` | [Ash Veneer](https://polyhaven.com/a/ash_veneer) | `ash_veneer_diff_2k.jpg` | `00abb70f86bdfe49aa6e09f350af9e8e1605ccf13171f9be46ceb6018846c06b` |
| `walnut.jpg` | [Natural Walnut Veneer](https://polyhaven.com/a/natural_walnut_veneer) | `natural_walnut_veneer_diff_2k.jpg` | `4a1a84e9537b291ac0cce1e2b8908fb9b5d1057a246ee0b3c25345565ac9686d` |

To remake them, download the three files from each asset's page (Textures, 2k, JPG, Diffuse) into
one folder and run `node scripts/wood-maps.mjs <that folder>`.
