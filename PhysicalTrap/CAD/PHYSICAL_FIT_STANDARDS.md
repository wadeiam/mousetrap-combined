# Mousetrap Project Rules & Instructions

See root guidelines in [AGENTS.md](../AGENTS.md).

## Critical Memory & Rules

1. **AUTONOMOUS PRINTING IS MANDATORY:**
   - You have direct, automated, headless slicing (`C:\Users\wadeiam\Documents\@AI\Claude\3DPrinting\tools\x2d_slice.py`) and direct network printing (`C:\Users\wadeiam\Documents\@AI\Claude\3DPrinting\tools\x2d_print.py`).
   - ALWAYS export STLs via `tools/x2d_export.py` (`python tools/x2d_export.py <model.scad> --part <part_name> --out <model.stl>`). NEVER use raw PowerShell `-D` commands (PowerShell strips quotes and leaves stale STLs).
   - `x2d_slice.py` has a hard-coded stale-STL abort gate and prints physical bounding boxes (`bounds_mm`). Always check `bounds_mm` before starting prints.
   - NEVER ask Wade to open Bambu Studio or print things himself.
   - When Wade asks to print ("print it", "print the test pieces", etc.), export via `x2d_export.py`, verify bounds, slice headlessly via `x2d_slice.py`, and launch the print via `x2d_print.py`.
   - Never launch `bambu-studio.exe` in GUI mode (it hangs).
   - Use AMS slot 4 (Bambu PETG Basic) and `process__0.20_Standard_X2D.json`.

2. **BOTTOM-LINE UP FRONT (BLUF):**
   - Provide exact dimensions, status, and numbers in the first sentence. No fluff, no stalling.

3. **VERIFY ALL MATING INTERFACES:**
   - Double check CAD features against physical photos (flanges, clearances, tabs).

## Physically Confirmed & Caliper-Verified Mating Dimensions (Validated on Physical Trap)

- **Ceiling Height Trim:**
  - `height_trim = 2.00 mm` (lowered ceiling by 2.00 mm total from initial CAD; confirmed good fit).
  - Housing outer collar height: `housing_h_out = 76.67 mm` (collar: `70.62 mm W x 76.67 mm H x 5.00 mm D`).
  - Spigot outer height: `spigot_total_h = 72.00 mm` from bottom Y=0 (`spigot_h_out = 70.00 mm` above 2.0mm floor).
- **Stepped Spigot & Depth Stop:**
  - Outer spigot width: `spigot_w_out = 59.00 mm` (0.5 mm total clearance inside 59.50 mm acrylic tunnel).
  - Total overlap depth: `spigot_len = 15.05 mm`.
  - Front thin sleeve: `spigot_sleeve_len = 10.00 mm` (1.40 mm wall thickness).
  - Stepped depth stop shoulder: `step_len = 5.05 mm`, steps up by `step_t = 0.90 mm` per side/top to butt squarely against clear acrylic tunnel front edge.
  - Top catch tab: `tab_w = 4.40 mm`, `tab_h = 2.20 mm`, shifted rearward by `clip_z_shift = 2.45 mm` to seat trap flush against 10.0mm step.
  - Bottom clearance cutout: `bottom_cutout_w = 61.00 mm x bottom_cutout_h = 24.00 mm` (clears 22.70mm high jutting bait box and baseplate).
- **Side Cantilever Snap Latches (100% Validated Lock):**
  - Lateral gap: `gap = 3.35 mm` (distance between spigot side wall and cantilever beam inner face; moved outward 1.0mm per side).
  - Arm outer face span: `69.30 mm` (Left arm outer face at $X = 0.66\text{ mm}$, Right arm outer face at $X = 69.96\text{ mm}$).
  - Hook total tip span: `71.70 mm` (`hook_h = 1.20 mm` protrusion).
  - Retaining geometry: Flat horizontal 90° undercut shelf at local $Z = 2.2\text{ mm}$ ($0.95\text{ mm}$ pure flat + $0.25\text{ mm}$ 45° root transition).
  - Entry ramp: 45° chamfer from $Z = 0.4\text{ mm}$ to $1.6\text{ mm}$.
  - Vertical position: `arm_y = 17.00 mm`, width `clip_w = 20.08 mm` ($Y = 17.00$ to $37.08\text{ mm}$).
  - Arm beam thickness: `clip_t = 1.80 mm` (sleek PETG compliance).
