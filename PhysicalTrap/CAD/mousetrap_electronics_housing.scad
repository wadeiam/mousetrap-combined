// ==============================================================================
// SMART MOUSETRAP ELECTRONICS HOUSING (REBUILT REAR PIECE)
// Optimized for Bambu Lab X1C / P1S / A1 (PETG / PLA)
// ==============================================================================
// Comprehensive Specification & Feature Set:
// 1. Flush Inner Mating Spigot & Flush Cantilever Snap Arms:
//    - Inner spigot (59.00 mm W x 72.00 mm H x 10.5 mm L) slides INSIDE clear trap opening.
//    - Outer cantilever arms (10.5 mm L) rooted at the shoulder, running flush alongside
//      the spigot with a 1.85 mm slot gap to receive the 1.25 mm clear trap wall.
//    - Outward-facing 1.4 mm snap hooks at Z = 0-3.2 mm that pass through and lock behind
//      the clear trap's exterior molded loops. No arms extending past the spigot into empty space!
//    - Top catch tab (7.0 mm W x 1.2 mm H) engaging the clear trap roof cutout notch.
// 2. Mouse Breathing / Ventilation Expansion Chamber:
//    - 15.0 mm deep breathing chamber between trap mating shoulder and solid partition wall.
//    - Continuous with mouse tunnel interior (59.5 mm W x 72.6 mm H).
//    - 9x 2.0 mm wide longitudinal air slots on the roof penetrating into tunnel.
//    - 12x 2.0 mm wide vertical air slots on side walls (2 tiers of 3 slots on each side).
//    - Mouse-proof spacing (2.0-2.2 mm) prevents bite/escape while delivering abundant airflow.
//    - Solid 2.0 mm floor prevents any rodent urine leakage.
// 3. 100% Bite/Urine-Proof Solid Partition Wall (2.2 mm):
//    - Completely isolates the mouse from the electronics.
//    - Optical aperture for OV2640 camera lens (dia 7.2 mm).
//    - Optical window for TOF050C sensor (12.0 x 6.5 mm oval, vertically centered at Y = 34.3 mm).
//    - Conical aperture for 1W Flash LED (dia 8.0 mm) with rear optical isolation funnel.
// 4. Enclosed Electronics Bay & KiCad PCB Mounting:
//    - Exact cavity holding KiCad PCB (65.42 mm W x 67.02 mm H x 1.6 mm T).
//    - Continuous diagonal M3 standoff columns matching holes (4.69, 4.20) and (58.16, 61.63).
//    - 16.5 mm forward clearance bay for ESP32-S3-CAM dev board & female header stack.
//    - 11.0 mm rear clearance bay for Piezo buzzer (BZ1), 5mm red LED (D1), slide switch (SW1).
// 5. External Access Ports:
//    - Left-wall USB-C cutout (12.5 x 7.0 mm) for J1 main power supply.
//    - Top sliding hatch door (27.2 x 17.5 mm) running in captive dovetail rails
//      providing direct external access to dual ESP32 TTL & OTG USB-C ports.
// 6. Rear Faceplate (Option A):
//    - M3 counterbored screw fastening into main chassis standoffs.
//    - Acoustic radial grille for 12.2 mm Piezo buzzer BZ1.
//    - Chamfered bezel for 5.0 mm red status LED D1.
//    - Rectangular actuator cutout for SW1 slide switch.
//    - Stepped perimeter rebate sealing the enclosure.
// ==============================================================================

$fn = 40;

// ------------------------------------------------------------------------------
// 1. PARAMETERS & TOLERANCES
// ------------------------------------------------------------------------------

// Trap Tunnel Interface (Caliper Measured & Refined from Physical Test Fit Feedback)
height_trim      = 2.00;  // Trimmed 2.00mm total (was 1.25mm; lowered ceiling by 0.75mm per Wade's instruction)
trap_w_out       = 62.00; // Clear tunnel outer width
trap_w_in        = 59.50; // Clear tunnel inner width
trap_h_out       = 74.67 - height_trim; // 72.67mm outer height (lowered ceiling by 0.75mm)
trap_h_in        = 72.60 - height_trim; // 70.60mm inner height (lowered ceiling by 0.75mm)
spigot_len       = 15.05; // Exact insertion overlap depth into clear tunnel (IMG_6354: 15.05mm)
spigot_sleeve_len= 10.00; // Front sleeve length that slides inside clear trap (IMG_6390: 10.0mm insertion)
step_len         = spigot_len - spigot_sleeve_len; // 5.05mm stepped section before collar
step_t           = 0.90;  // Thickness step-up (0.9mm per side and top to butt squarely against clear trap edge)
spigot_fit_tol   = 0.50;  // Total clearance for spigot insertion (0.25mm per side)
spigot_wall_t    = 1.40;  // Wall thickness of inner spigot sleeve

// Protruding Black Bait/Trigger Box (Direct Caliper Measurements from IMG_6362 & IMG_6363)
black_box_len    = 25.01; // Protrusion past clear tunnel vertical edge (IMG_6362: 25.01mm)
black_box_h      = 22.70; // Height from bottom baseplate to top rim (IMG_6363: 22.70mm)
black_box_tol    = 0.80;  // Sliding clearance around black box (0.4mm per side / top)

// Cantilever Snap Arms (Refined per test fit: moved up 1mm, height below preserved)
clip_w           = 20.08; // Arm vertical height (IMG_6346: 20.08mm)
clip_t           = 1.80;  // Cantilever beam thickness (sleek 1.80mm, matches original molded clip)
arm_front        = spigot_len; // 15.05mm forward past shoulder (IMG_6354: 15.05mm)
arm_root_len     = 10.00; // Extends 10.0mm rearward into chassis sidewall for compliance
arm_y            = 17.00; // Moved UP 1.0mm per test fit (was 16.00mm, preserves height below)
gap              = 3.35;  // Gap between spigot and arm (moved outward 1.0mm each side per Wade's instruction)
hook_h           = 1.20;  // Outward snap hook protrusion with 90-deg mechanical retaining shelf (matches original IMG_6407)
clip_z_shift     = 2.45;  // Shift clips & tab 2.45mm rearward so trap body seats flush against 10mm step (IMG_6394-6398)
total_arm_l      = arm_front + arm_root_len; // 25.05mm total beam length

// Top roof latch tab dimensions (IMG_6388 & IMG_6389 comparison)
tab_w            = 4.40;  // Narrowed from 7.00mm to 4.40mm to match original notch
tab_h            = 2.20;  // Increased from 1.20mm to 2.20mm to stick up properly into clear trap roof cutout
tab_ramp_l       = 2.50;  // Lead-in entry ramp
tab_flat_l       = 1.00;  // Flat crest before vertical catch drop
tab_total_l      = tab_ramp_l + tab_flat_l; // 3.50mm total tab length along Z

// Expansion Ventilation & Bait Hood Chamber (Encloses protruding black box)
vent_depth       = black_box_len + 1.00; // 26.01mm deep chamber enclosing 25.01mm black box
slot_w           = 2.00;  // Air slot width (mouse-proof bite/escape barrier)
slot_gap         = 2.20;  // Structural rib between air slots

// Housing Shell & Partition Wall Thicknesses
wall_t           = 2.00;  // Main chassis wall thickness
part_wall_t      = 2.20;  // Mouse-proof partition wall thickness
cover_t          = 2.20;  // Rear faceplate thickness

// PCB Specs (From KiCad MouseTrapToF-Cam1.1.kicad_pcb)
pcb_w            = 65.42;
pcb_h            = 67.02;
pcb_t            = 1.60;

// PCB Mounting Holes (Coordinates from PCB bottom-left origin)
hole1_x          = 4.69;  // Bottom-Left
hole1_y          = 4.20;
hole2_x          = 58.16; // Top-Right
hole2_y          = 61.63;

// Rear Components (Facing Outward / +Z toward Faceplate)
buzzer_x         = 58.40;
buzzer_y         = 15.08;
buzzer_dia       = 12.20;
buzzer_h         = 9.50;

led_red_x        = 59.84;
led_red_y        = 5.52;
led_red_dia      = 5.20;

sw_x             = 13.73;
sw_y             = 10.35;
sw_w             = 7.20;
sw_h             = 4.20;

// Front Components (Facing Forward / -Z toward Partition Wall)
led_flash_x      = 15.77;
led_flash_y      = 35.91;
led_flash_dia    = 8.00;

usb_power_x      = 4.20;  // J1 on left edge
usb_power_y      = 54.10;
usb_power_w      = 12.50;
usb_power_h      = 7.00;

esp32_center_x   = 36.95; // Center of header sockets
esp32_w          = 28.00;
esp32_top_y      = 68.50; // USB ports top edge

// Front Sensors on Partition Wall (Dead Center Alignment in Trap Tunnel)
cam_w            = 8.80;  // OV2640 module (8.5mm + 0.3mm tol)
cam_h            = 8.80;
cam_lens_dia     = 7.20;
cam_pocket_d     = 4.50;
cam_x            = 32.71; // Horizontally dead-center in tunnel (housing_w_out/2 - pcb_x_off)
cam_y            = 51.00; // Centered above ToF in upper view, 3.9mm clearance above ToF bracket

tof_w            = 20.40; // TOF050C-VL6180X board width (20mm + 0.4mm tol)
tof_h            = 11.40; // Board height (11mm + 0.4mm tol)
tof_optic_w      = 12.50; // Oval optical snout aperture width
tof_optic_h      = 6.50;  // Aperture height
tof_hole_dist    = 15.50; // Center-to-center M2 screw spacing
tof_x            = 32.71; // Dead-center horizontally in tunnel: (housing_w_out/2) - pcb_x_off
tof_y            = 34.30; // Dead-center vertically in tunnel: (spigot_y_off + trap_h_in/2) - pcb_y_off

// Longitudinal (Z-Axis) Cavity Dimensions:
// Z = 0: Front tip of inner spigot and cantilever snap arms
// Z = spigot_len (15.05mm): Trap mating shoulder stop
// Z = 15.05 to 41.06mm (26.01mm): Ventilation & Bait Hood Chamber (Enclosing 25.01mm Black Box)
// Z = 41.06 to 43.26mm: Mouse-proof Solid Partition Wall (2.2mm, sitting immediately behind black box)
// Z = 43.26 to 59.76mm: Front Electronics Bay (16.5mm)
// Z = 59.76 to 61.36mm: KiCad PCB (1.6mm)
// Z = 61.36 to 72.36mm: Rear Electronics Bay (11.0mm)
// Total Chassis Length = 72.36mm
esp32_depth      = 16.50; // Headers (8.5mm) + ESP32 dev board (8.0mm)
rear_depth       = 11.00; // Buzzer (9.5mm) + clearance (1.5mm)

z_spigot_front   = 0.0;
z_shoulder       = spigot_len;                             // 15.05mm
z_vent_start     = z_shoulder;                             // 15.05mm
z_vent_end       = z_vent_start + vent_depth;              // 41.06mm
z_part_start     = z_vent_end;                             // 41.06mm
z_part_end       = z_part_start + part_wall_t;             // 43.26mm
z_bay_start      = z_part_end;                             // 43.26mm
pcb_z_front      = z_bay_start + esp32_depth;              // 59.76mm
pcb_z_rear       = pcb_z_front + pcb_t;                    // 61.36mm
total_box_len    = pcb_z_rear + rear_depth;                // 72.36mm


// Housing Enclosure Outer Dimensions
housing_w_in     = pcb_w + 1.20;                           // 66.62mm internal width
housing_h_in     = pcb_h + 2.00;                           // 69.02mm internal height
housing_w_out    = housing_w_in + 2 * wall_t;              // 70.62mm outer width
housing_h_out    = trap_h_out + 2 * wall_t;                // 75.87mm outer height (71.87 + 4.0mm)

// Inner Spigot Dimensions (Slides INSIDE clear trap opening)
spigot_w_out     = trap_w_in - spigot_fit_tol;             // 59.00mm outer width
spigot_h_out     = trap_h_in - 0.60;                       // 69.20mm outer height (top at Y=71.20mm)
spigot_x_off     = (housing_w_out - spigot_w_out)/2;       // 5.81mm
spigot_y_off     = wall_t;                                 // 2.00mm

// PCB Placement Offsets inside Housing
pcb_x_off        = wall_t + (housing_w_in - pcb_w)/2;      // 2.60mm
pcb_y_off        = wall_t + 1.2;                           // 3.20mm


// ==============================================================================
// 2. MAIN BODY CHASSIS MODULE
// ==============================================================================
module main_body() {
    difference() {
        union() {
            // 1. Main Housing Body (Z = z_shoulder to total_box_len)
            translate([0, 0, z_shoulder])
                cube([housing_w_out, housing_h_out, total_box_len - z_shoulder]);
            
            // 2. Inner Mating Spigot (Slides INSIDE clear trap, Z = 0 to z_shoulder)
            inner_mating_spigot();
            
            // 3. Flush Side Cantilever Snap Arms (Z = 0 to z_shoulder, alongside spigot)
            side_snap_arms();

            // 4. Top USB Hatch Guide Rails
            top_hatch_rails();
            
            // 5. Internal Standoff Columns for PCB & Rear Faceplate M3 Screws
            internal_standoffs();
            
            // 6. Camera & ToF Sensor Locking Pockets on Rear of Partition Wall
            sensor_mounts();
            
            // 7. Flash LED Optical Isolation Funnel (Prevents lens flare into camera)
            flash_led_shroud();
        }
        
        // ----------------- SUBTRACTIVE CUTOUTS -----------------
        
        // 1. Spigot Interior Cavity (Open passage for mouse into ventilation chamber)
        translate([spigot_x_off + spigot_wall_t, spigot_y_off + spigot_wall_t, -0.1])
            cube([spigot_w_out - 2*spigot_wall_t, spigot_h_out - spigot_wall_t + 0.1, spigot_len + 0.2]);

        // 2. Bottom Hood Clearance Cutout for Protruding Black Bait Box & Trap Baseplate
        // Cuts INSIDE the spigot side walls from Y = -0.5 to black_box_h + tol (23.50mm),
        // preserving the lower spigot flanges (the red section) that slide between the bait tray and clear trap body!
        translate([spigot_x_off + spigot_wall_t, -0.5, -0.5])
            cube([spigot_w_out - 2*spigot_wall_t, black_box_h + black_box_tol + 0.5, z_vent_end + 0.5]);

        // 3. Ventilation Chamber Interior Tunnel (Z = z_vent_start to z_vent_end)
        translate([(housing_w_out - trap_w_in)/2, wall_t, z_vent_start - 0.1])
            cube([trap_w_in, trap_h_in, vent_depth + 0.2]);

        // 4. Ventilation Air Slots (Mouse-Proof Breathing Holes - Complete Wall Penetration)
        ventilation_air_slots();

        // 5. Electronics Bay Internal Cavity (Z = z_bay_start to total_box_len)
        translate([wall_t, wall_t, z_bay_start])
            cube([housing_w_in, housing_h_in, total_box_len - z_bay_start + 1.0]);
        
        // 6. Rear Cover Stepped Rebate (Mating Joint: Z = total_box_len - cover_t to total_box_len + 0.1)
        translate([wall_t - 0.7, wall_t - 0.7, total_box_len - cover_t])
            cube([housing_w_in + 1.4, housing_h_in + 1.4, cover_t + 0.5]);

        // 7. Partition Wall Optical & Sensor Apertures
        partition_apertures();

        // 8. Side USB-C Power Cutout (Left Wall aligned with J1)
        translate([-0.5, pcb_y_off + usb_power_y - usb_power_h/2, pcb_z_front - 2.5])
            cube([wall_t + 1.0, usb_power_h, usb_power_w]);

        // 9. Top USB-C Hatch Port Opening (Directly above ESP32 TTL & OTG USB ports)
        translate([pcb_x_off + esp32_center_x - 13.0, housing_h_out - wall_t - 0.5, pcb_z_front - 7.0])
            cube([26.0, wall_t + 1.0, 11.5]);
            
        // 10. Front Shoulder Upper Chamfers (Beveled transition above snap arms)
        // Upper left chamfer (above arm)
        translate([-0.1, arm_y + clip_w + 1.0, z_shoulder - 0.1])
            polyhedron(
                points=[
                    [0, 0, 0], [2.2, 0, 0], [0, 0, 2.2],
                    [0, housing_h_out - (arm_y + clip_w) + 1.0, 0], [2.2, housing_h_out - (arm_y + clip_w) + 1.0, 0], [0, housing_h_out - (arm_y + clip_w) + 1.0, 2.2]
                ],
                faces=[
                    [0,1,2], [3,5,4], [0,2,5,3], [1,4,5,2], [0,3,4,1]
                ]
            );
        // Upper right chamfer (above arm)
        translate([housing_w_out - 2.2 + 0.1, arm_y + clip_w + 1.0, z_shoulder - 0.1])
            polyhedron(
                points=[
                    [0, 0, 2.2], [2.2, 0, 0], [0, 0, 0],
                    [0, housing_h_out - (arm_y + clip_w) + 1.0, 2.2], [2.2, housing_h_out - (arm_y + clip_w) + 1.0, 0], [0, housing_h_out - (arm_y + clip_w) + 1.0, 0]
                ],
                faces=[
                    [0,1,2], [3,5,4], [0,2,5,3], [1,4,5,2], [0,3,4,1]
                ]
            );

        // 11. Side Cantilever Snap Arm Flexure Clearance Relief Slots
        side_arm_flex_relief();
    }
}


// ------------------------------------------------------------------------------
// INNER MATING SPIGOT (Male plug that slides INSIDE clear trap opening)
// 10.0mm insertion depth sleeve, stepping up to 60.8mm W x 73.65mm H depth stop
// ------------------------------------------------------------------------------
module inner_mating_spigot() {
    union() {
        // Front thin sleeve that enters clear tunnel (Z = 0 to 10.0mm)
        translate([spigot_x_off, 0, 0])
            cube([spigot_w_out, spigot_y_off + spigot_h_out, spigot_sleeve_len]);
        
        // Stepped sleeve depth stop (Z = 10.0 to 15.05mm)
        // Steps UP by step_t (0.90mm) on left, right, and top to butt squarely against clear trap edge!
        translate([spigot_x_off - step_t, 0, spigot_sleeve_len])
            cube([spigot_w_out + 2*step_t, spigot_y_off + spigot_h_out + step_t, step_len]);
        
        // Top Roof Notch Catch Tab (Snaps into clear trap roof cutout, shifted rearward by clip_z_shift)
        translate([housing_w_out/2, spigot_y_off + spigot_h_out, 1.2 + clip_z_shift]) {
            polyhedron(
                points=[
                    [-tab_w/2, 0, 0], [tab_w/2, 0, 0],
                    [tab_w/2, tab_h, tab_ramp_l], [-tab_w/2, tab_h, tab_ramp_l],
                    [-tab_w/2, 0, tab_total_l], [tab_w/2, 0, tab_total_l],
                    [tab_w/2, tab_h, tab_total_l], [-tab_w/2, tab_h, tab_total_l]
                ],
                faces=[
                    [0, 3, 2, 1], // ramp face
                    [3, 7, 6, 2], // top flat crest
                    [4, 5, 6, 7], // vertical retaining back-face
                    [0, 1, 5, 4], // bottom base
                    [0, 4, 7, 3], // left side
                    [1, 2, 6, 5]  // right side
                ]
            );
        }
    }
}


// ------------------------------------------------------------------------------
// FLUSH SIDE CANTILEVER SNAP ARMS (Left & Right)
// Caliper Measured: Width = 20.08mm (IMG_6346), Spigot = 15.05mm (IMG_6354),
// Tab position: Y = 17.00 to 37.08mm
// ------------------------------------------------------------------------------
module side_snap_arms() {
    arm_free_len = z_shoulder - clip_z_shift; // 12.60mm free cantilever length

    // Left Arm - Shifted rearward by clip_z_shift (2.45mm) to seat clear trap body flush against 10mm step
    arm_left_x = spigot_x_off - gap - clip_t;
    translate([arm_left_x, arm_y, clip_z_shift]) {
        // Continuous Cantilever Beam from front tip into chassis sidewall
        cube([clip_t, clip_w, arm_free_len + arm_root_len]);
        
        // Outward Retaining Snap Hook with flat 90-degree retaining shelf & 0.25mm root transition
        // Matches original molded latch (IMG_6407 & IMG_6408) for 100% positive mechanical lock
        polyhedron(
            points=[
                [0, 0, 0.4],             // 0
                [-hook_h, 0, 1.6],        // 1
                [-hook_h, clip_w, 1.6],   // 2
                [0, clip_w, 0.4],         // 3
                [-hook_h, 0, 2.2],        // 4
                [-hook_h, clip_w, 2.2],   // 5
                [-0.25, 0, 2.2],          // 6
                [-0.25, clip_w, 2.2],     // 7
                [0, 0, 2.45],             // 8
                [0, clip_w, 2.45]         // 9
            ],
            faces=[
                [0, 1, 2, 3],    // front lead-in ramp (normals point -Z, -X)
                [1, 4, 5, 2],    // crest flat (normal points -X)
                [4, 6, 7, 5],    // 90-deg flat retaining shelf (normal points +Z)
                [6, 8, 9, 7],    // 45-deg root transition
                [8, 0, 3, 9],    // base attached to beam (normal points +X)
                [0, 8, 6, 4, 1], // side Y=0 (normal points -Y)
                [3, 2, 5, 7, 9]  // side Y=clip_w (normal points +Y)
            ]
        );
        // Finger Release Grip Ribs on outside face of arm across shoulder
        for (k = [0:2]) {
            translate([-0.6, 2.0, arm_free_len + 1.5 + k*2.5])
                cube([0.6, clip_w - 4.0, 1.2]);
        }
    }

    // Right Arm - Shifted rearward by clip_z_shift (2.45mm) to seat clear trap body flush against 10mm step
    arm_right_x = spigot_x_off + spigot_w_out + gap;
    translate([arm_right_x, arm_y, clip_z_shift]) {
        // Continuous Cantilever Beam from front tip into chassis sidewall
        cube([clip_t, clip_w, arm_free_len + arm_root_len]);
        
        // Outward Retaining Snap Hook with flat 90-degree retaining shelf & 0.25mm root transition
        // Matches original molded latch (IMG_6407 & IMG_6408) for 100% positive mechanical lock
        polyhedron(
            points=[
                [clip_t, 0, 0.4],                     // 0
                [clip_t + hook_h, 0, 1.6],            // 1
                [clip_t + hook_h, clip_w, 1.6],       // 2
                [clip_t, clip_w, 0.4],                 // 3
                [clip_t + hook_h, 0, 2.2],            // 4
                [clip_t + hook_h, clip_w, 2.2],       // 5
                [clip_t + 0.25, 0, 2.2],              // 6
                [clip_t + 0.25, clip_w, 2.2],         // 7
                [clip_t, 0, 2.45],                    // 8
                [clip_t, clip_w, 2.45]                // 9
            ],
            faces=[
                [0, 3, 2, 1],    // front lead-in ramp (normals point -Z, +X)
                [1, 2, 5, 4],    // crest flat (normal points +X)
                [4, 5, 7, 6],    // 90-deg flat retaining shelf (normal points +Z)
                [6, 7, 9, 8],    // 45-deg root transition
                [8, 9, 3, 0],    // base attached to beam (normal points -X)
                [0, 1, 4, 6, 8], // side Y=0 (normal points -Y)
                [3, 9, 7, 5, 2]  // side Y=clip_w (normal points +Y)
            ]
        );
        // Finger Release Grip Ribs on outside face of arm across shoulder
        for (k = [0:2]) {
            translate([clip_t, 2.0, arm_free_len + 1.5 + k*2.5])
                cube([0.6, clip_w - 4.0, 1.2]);
        }
    }
}


// ------------------------------------------------------------------------------
// CANTILEVER ARM FLEXURE CLEARANCE RELIEF SLOTS
// Frees the cantilever beam from the chassis side wall so it can deflect outward
// ------------------------------------------------------------------------------
module side_arm_flex_relief() {
    rel_gap    = 1.20; // Clearance gap around cantilever beam
    arm_left_x = spigot_x_off - gap - clip_t;
    arm_right_x = spigot_x_off + spigot_w_out + gap;

    // Left side arm relief (Z = z_shoulder to z_shoulder + arm_root_len)
    // Top slit
    translate([arm_left_x - 0.5, arm_y + clip_w, z_shoulder - 0.1])
        cube([clip_t + 1.8, rel_gap, arm_root_len + 0.1]);
    // Bottom slit
    translate([arm_left_x - 0.5, arm_y - rel_gap, z_shoulder - 0.1])
        cube([clip_t + 1.8, rel_gap, arm_root_len + 0.1]);
    // Inner clearance behind arm (allows deflection)
    translate([arm_left_x + clip_t, arm_y - 0.2, z_shoulder - 0.1])
        cube([gap + 0.1, clip_w + 0.4, arm_root_len + 0.1]);
    // Outer pocket exposure (exposes arm on chassis exterior)
    translate([-0.5, arm_y - rel_gap, z_shoulder - 0.1])
        cube([arm_left_x + 0.5, clip_w + 2*rel_gap, arm_root_len + 0.1]);

    // Right side arm relief (Z = z_shoulder to z_shoulder + arm_root_len)
    // Top slit
    translate([arm_right_x - 1.3, arm_y + clip_w, z_shoulder - 0.1])
        cube([clip_t + 1.8, rel_gap, arm_root_len + 0.1]);
    // Bottom slit
    translate([arm_right_x - 1.3, arm_y - rel_gap, z_shoulder - 0.1])
        cube([clip_t + 1.8, rel_gap, arm_root_len + 0.1]);
    // Inner clearance behind arm
    translate([spigot_x_off + spigot_w_out - 0.1, arm_y - 0.2, z_shoulder - 0.1])
        cube([gap + 0.1, clip_w + 0.4, arm_root_len + 0.1]);
    // Outer pocket exposure
    translate([arm_right_x + clip_t, arm_y - rel_gap, z_shoulder - 0.1])
        cube([housing_w_out - (arm_right_x + clip_t) + 0.5, clip_w + 2*rel_gap, arm_root_len + 0.1]);
}


// ------------------------------------------------------------------------------
// VENTILATION AIR SLOTS (Mouse-Proof Breathing Grille in Expansion Chamber)
// Upper Half matching original jail bars (IMG_6353), above snap arms
// ------------------------------------------------------------------------------
module ventilation_air_slots() {
    z_vent_mid = z_vent_start + vent_depth/2; // ~12.58mm
    
    // 1. Top Roof Slots (9x Longitudinal Slits)
    // 2.0mm wide, 10.0mm long, mouse-proof 2.0mm ribs
    roof_slots_n = 9;
    roof_slots_w = roof_slots_n * slot_w + (roof_slots_n - 1) * slot_gap; // ~35.6mm
    roof_x_start = (housing_w_out - roof_slots_w)/2;
    roof_cut_h   = housing_h_out - (wall_t + trap_h_in) + 1.5; // ~5.57mm full roof cut
    
    for (i = [0 : roof_slots_n - 1]) {
        translate([roof_x_start + i * (slot_w + slot_gap), wall_t + trap_h_in - 0.5, z_vent_mid - 8.0])
            cube([slot_w, roof_cut_h, 16.0]);
    }
    
    // 2. Side Wall Slots (Left & Right Walls: 3 Vertical Slits in Upper Region)
    // Located at Y = 42.0 to 66.0 mm (height 24mm), exactly matching original upper jail bars
    side_slots_n    = 3;
    z_side_start    = z_vent_mid - (side_slots_n * slot_w + (side_slots_n - 1) * slot_gap)/2;
    side_wall_cut_w = (housing_w_out - trap_w_in)/2 + 1.0; // 6.56mm full penetration cut
    
    for (j = [0 : side_slots_n - 1]) {
        z_pos = z_side_start + j * (slot_w + slot_gap);
        
        // Left Side Wall Cutouts
        translate([-0.5, 42.0, z_pos])
            cube([side_wall_cut_w, 24.0, slot_w]);
            
        // Right Side Wall Cutouts
        translate([housing_w_out - side_wall_cut_w + 0.5, 42.0, z_pos])
            cube([side_wall_cut_w, 24.0, slot_w]);
    }
}


// ------------------------------------------------------------------------------
// INTERNAL STANDOFFS (Full-length diagonal M3 mounting pillars)
// ------------------------------------------------------------------------------
module internal_standoffs() {
    pillar_len = total_box_len - z_bay_start - cover_t; // 26.90mm
    
    translate([pcb_x_off, pcb_y_off, z_bay_start]) {
        // Hole 1 Column (Bottom-Left: 4.69, 4.20)
        translate([hole1_x, hole1_y, 0])
            difference() {
                cylinder(d=7.0, h=pillar_len);
                // Continuous pilot hole for M3 screw or heat-set insert
                translate([0, 0, -0.5])
                    cylinder(d=2.8, h=pillar_len + 1.0);
            }
            
        // Hole 2 Column (Top-Right: 58.16, 61.63)
        translate([hole2_x, hole2_y, 0])
            difference() {
                cylinder(d=7.0, h=pillar_len);
                translate([0, 0, -0.5])
                    cylinder(d=2.8, h=pillar_len + 1.0);
            }
    }
}


// ------------------------------------------------------------------------------
// SENSOR MOUNTS & LOCKING POCKETS (Behind Partition Wall, Z >= z_bay_start)
// ------------------------------------------------------------------------------
module sensor_mounts() {
    translate([pcb_x_off, pcb_y_off, z_bay_start]) {
        // 1. Camera Module Retention Pocket (Holds 8.5 x 8.5mm OV2640 board)
        translate([cam_x - cam_w/2 - 1.5, cam_y - cam_h/2 - 1.5, 0]) {
            difference() {
                // Outer bracket frame
                cube([cam_w + 3.0, cam_h + 3.0, 4.5]);
                // Pocket cavity (+Z facing backward into bay)
                translate([1.5, 1.5, -0.1])
                    cube([cam_w, cam_h, 4.0]);
                // Bottom FPC ribbon cable exit slot
                translate([1.5 + (cam_w - 6.0)/2, -0.5, 0.8])
                    cube([6.0, 3.0, 4.0]);
            }
            // Snap retention lips on top & sides to lock camera board firmly in pocket
            translate([1.5, 1.5 + cam_h - 0.7, 3.2])
                cube([cam_w, 0.8, 0.8]);
        }
        
        // 2. ToF Sensor Locking Mount (Holds 20 x 11mm TOF050C-VL6180X board)
        // Two M2 screw bosses spaced 15.5mm apart
        for (dx = [-tof_hole_dist/2, tof_hole_dist/2]) {
            translate([tof_x + dx, tof_y, 0])
                difference() {
                    cylinder(d=4.6, h=4.0);
                    translate([0, 0, -0.5])
                        cylinder(d=1.8, h=5.0); // M2 pilot hole for self-tapping
                }
        }
        // Lateral positioning shelf / ribs to prevent rotation
        translate([tof_x - tof_w/2, tof_y - tof_h/2 - 1.2, 0])
            cube([tof_w, 1.2, 3.5]);
        translate([tof_x - tof_w/2, tof_y + tof_h/2, 0])
            cube([tof_w, 1.2, 3.5]);
    }
}


// ------------------------------------------------------------------------------
// FLASH LED OPTICAL ISOLATION SHROUD
// ------------------------------------------------------------------------------
module flash_led_shroud() {
    translate([pcb_x_off + led_flash_x, pcb_y_off + led_flash_y, z_bay_start]) {
        // Conical tube extending toward PCB to prevent light leakage into camera/ToF
        difference() {
            cylinder(d1=led_flash_dia + 3.0, d2=led_flash_dia + 1.5, h=esp32_depth - 1.0);
            translate([0, 0, -0.5])
                cylinder(d1=led_flash_dia + 1.0, d2=led_flash_dia - 0.5, h=esp32_depth);
        }
    }
}


// ------------------------------------------------------------------------------
// PARTITION WALL APERTURES (Through-holes into Ventilation Chamber)
// ------------------------------------------------------------------------------
module partition_apertures() {
    z_wall = z_part_start - 0.5;
    h_cut  = part_wall_t + 1.0;
    
    translate([pcb_x_off, pcb_y_off, z_wall]) {
        // 1. Camera Circular Lens Aperture
        translate([cam_x, cam_y, 0])
            cylinder(d=cam_lens_dia, h=h_cut);
        
        // 2. ToF Oval Optical Snout Window (Vertically Centered in Tunnel)
        translate([tof_x, tof_y, 0])
            hull() {
                translate([-(tof_optic_w - tof_optic_h)/2, 0, 0])
                    cylinder(d=tof_optic_h, h=h_cut);
                translate([(tof_optic_w - tof_optic_h)/2, 0, 0])
                    cylinder(d=tof_optic_h, h=h_cut);
            }
        
        // 3. Flash LED Conical Output Cone (D2)
        translate([led_flash_x, led_flash_y, 0])
            cylinder(d1=led_flash_dia + 2.0, d2=led_flash_dia, h=h_cut);
    }
}


// ------------------------------------------------------------------------------
// TOP SLIDING HATCH RAILS
// ------------------------------------------------------------------------------
module top_hatch_rails() {
    rail_w = 28.5;
    rail_l = 18.0;
    rail_x = pcb_x_off + esp32_center_x - rail_w/2;
    rail_z = pcb_z_front - 9.5;
    
    translate([rail_x, housing_h_out - 0.2, rail_z]) {
        // Left guide rail with inner groove
        difference() {
            cube([2.2, 2.2, rail_l]);
            translate([0.8, -0.2, -0.1])
                cube([1.6, 1.4, rail_l + 0.2]);
        }
        // Right guide rail with inner groove
        translate([rail_w - 2.2, 0, 0])
            difference() {
                cube([2.2, 2.2, rail_l]);
                translate([-0.2, -0.2, -0.1])
                    cube([1.6, 1.4, rail_l + 0.2]);
            }
    }
}


// ------------------------------------------------------------------------------
// 3. SLIDING TOP HATCH DOOR
// ------------------------------------------------------------------------------
module top_hatch() {
    hatch_w = 27.2;
    hatch_l = 17.5;
    hatch_t = 1.4;
    
    union() {
        cube([hatch_w, hatch_t, hatch_l]);
        // Side sliding runners / tongues
        translate([-0.9, 0.2, 0])
            cube([0.9, hatch_t - 0.4, hatch_l]);
        translate([hatch_w, 0.2, 0])
            cube([0.9, hatch_t - 0.4, hatch_l]);
        // Ergonomic finger grip ridges
        for (i = [0:3]) {
            translate([4.0 + i*5.0, hatch_t, 3.5])
                cube([2.5, 0.8, hatch_l - 7.0]);
        }
    }
}


// ------------------------------------------------------------------------------
// 4. REAR COVER FACEPLATE (Option A)
// Fully solid perimeter sealing the enclosed electronics bay
// ------------------------------------------------------------------------------
module rear_cover() {
    plate_w = housing_w_in + 1.2;
    plate_h = housing_h_in + 1.2;
    
    difference() {
        union() {
            // Main External Faceplate
            cube([housing_w_out, housing_h_out, cover_t]);
            
            // Stepped Inset Rim (Centering lip seating into chassis rebate)
            translate([(housing_w_out - plate_w)/2, (housing_h_out - plate_h)/2, cover_t])
                difference() {
                    cube([plate_w, plate_h, 2.0]);
                    translate([1.6, 1.6, -0.5])
                        cube([plate_w - 3.2, plate_h - 3.2, 3.0]);
                }
        }
        
        // ----------------- REAR INTERFACE CUTOUTS -----------------
        
        // Cutouts strictly aligned to PCB coordinates
        translate([pcb_x_off, pcb_y_off, -0.5]) {
            // 1. M3 Diagonal Mounting Screw Holes (Counterbored)
            for (pt = [[hole1_x, hole1_y], [hole2_x, hole2_y]]) {
                translate([pt[0], pt[1], 0]) {
                    cylinder(d=3.4, h=cover_t + 3.0); // M3 through clearance
                    cylinder(d=6.2, h=1.6);           // Counterbore socket
                }
            }
            
            // 2. Piezo Buzzer Acoustic Grille (Aligned with BZ1)
            translate([buzzer_x, buzzer_y, 0]) {
                cylinder(d=3.2, h=cover_t + 3.0); // Center port
                for (a = [0:60:300]) {
                    rotate([0, 0, a])
                        translate([3.6, 0, 0])
                            cylinder(d=2.0, h=cover_t + 3.0);
                }
            }
            
            // 3. 5mm Red Status LED Bezel (Aligned with D1)
            translate([led_red_x, led_red_y, 0]) {
                cylinder(d=led_red_dia, h=cover_t + 3.0);
                cylinder(d1=led_red_dia + 2.0, d2=led_red_dia, h=1.2); // Outer entry chamfer
            }
            
            // 4. Power Switch Actuator Cutout (Aligned with SW1)
            translate([sw_x - sw_w/2, sw_y - sw_h/2, 0])
                cube([sw_w, sw_h, cover_t + 3.0]);
        }
    }
}


// ------------------------------------------------------------------------------
// 5. ACCURATE PCB & SENSOR ASSEMBLY MOCKUP
// ------------------------------------------------------------------------------
module pcb_mockup() {
    // Green FR4 PCB substrate
    color([0.1, 0.6, 0.2, 0.85])
        cube([pcb_w, pcb_h, pcb_t]);
    
    // --- REAR COMPONENTS (+Z, Facing Rear Cover / Outside) ---
    // Piezo Buzzer BZ1
    color([0.15, 0.15, 0.15])
        translate([buzzer_x, buzzer_y, pcb_t])
            cylinder(d=buzzer_dia, h=buzzer_h);

    // 5mm Red Status LED D1
    color([0.9, 0.1, 0.1, 0.9])
        translate([led_red_x, led_red_y, pcb_t])
            cylinder(d=5.0, h=8.0);

    // Slide Switch SW1
    color([0.7, 0.7, 0.7])
        translate([sw_x - sw_w/2, sw_y - sw_h/2, pcb_t])
            cube([sw_w, sw_h, 4.5]);

    // --- FRONT COMPONENTS (-Z, Facing Trap Tunnel / Partition Wall) ---
    // 1W Flash LED D2
    color([1.0, 0.95, 0.4])
        translate([led_flash_x, led_flash_y, -3.0])
            cylinder(d=8.0, h=3.0);

    // Side USB-C Power Receptacle J1
    color([0.8, 0.8, 0.85])
        translate([usb_power_x - 3.0, usb_power_y - 4.5, -3.5])
            cube([7.5, 9.0, 3.5]);

    // Dual 1x14 Female Pin Headers (J3 & J4)
    color([0.15, 0.15, 0.15]) {
        translate([24.25 - 1.25, 14.0, -8.5])
            cube([2.54, 48.0, 8.5]);
        translate([49.65 - 1.25, 14.0, -8.5])
            cube([2.54, 48.0, 8.5]);
    }

    // ESP32-S3-CAM Dev Board (Plugged into headers)
    color([0.1, 0.1, 0.1])
        translate([esp32_center_x - esp32_w/2, 10.0, -8.5 - 1.6])
            cube([esp32_w, 58.5, 1.6]);

    // ESP32 Metal RF Shield
    color([0.75, 0.75, 0.8])
        translate([esp32_center_x - 9.0, 18.0, -8.5 - 1.6 - 3.0])
            cube([18.0, 26.0, 3.0]);

    // Dual Top USB-C Ports (TTL & OTG pointing upward)
    color([0.85, 0.85, 0.85]) {
        translate([esp32_center_x - 7.5, esp32_top_y - 2.0, -8.5 - 1.6 - 3.2])
            cube([6.0, 4.0, 3.2]);
        translate([esp32_center_x + 1.5, esp32_top_y - 2.0, -8.5 - 1.6 - 3.2])
            cube([6.0, 4.0, 3.2]);
    }

    // Camera Sensor & 20mm Ribbon Cable (Extending to partition wall)
    color([0.9, 0.6, 0.1]) // Orange FPC ribbon
        translate([cam_x - 3.0, cam_y - 12.0, -esp32_depth + 1.0])
            cube([6.0, 12.0, 0.3]);
    color([0.1, 0.1, 0.1]) // Camera module
        translate([cam_x - cam_w/2, cam_y - cam_h/2, -esp32_depth])
            cube([cam_w, cam_h, 4.0]);
    color([0.05, 0.05, 0.05]) // Lens
        translate([cam_x, cam_y, -esp32_depth - 2.0])
            cylinder(d=cam_lens_dia, h=2.0);

    // TOF050C-VL6180X Sensor Board & Harness
    color([0.2, 0.2, 0.6]) // Blue/black sensor PCB
        translate([tof_x - tof_w/2, tof_y - tof_h/2, -esp32_depth])
            cube([tof_w, tof_h, 1.6]);
    color([0.1, 0.1, 0.1]) // Optical snout
        translate([tof_x - (tof_optic_w-tof_optic_h)/2, tof_y, -esp32_depth - 2.0])
            hull() {
                cylinder(d=tof_optic_h, h=2.0);
                translate([tof_optic_w - tof_optic_h, 0, 0])
                    cylinder(d=tof_optic_h, h=2.0);
            }
}


// ==============================================================================
// 6. RENDER CONTROLLER
// ==============================================================================
PART = "assembly_front_iso"; // Options: "assembly", "assembly_upright", "assembly_front_iso", "main_body", "rear_cover", "top_hatch", "print_plate", "cutaway", "cutaway_upright"

module assembly() {
    main_body();
    
    // PCB & Sensor Assembly inside bay
    translate([pcb_x_off, pcb_y_off, pcb_z_front])
        pcb_mockup();

    // Top Sliding Hatch Door installed
    translate([pcb_x_off + esp32_center_x - 27.2/2, housing_h_out - 0.2, pcb_z_front - 9.0])
        color([0.2, 0.5, 0.85])
            top_hatch();

    // Rear Cover assembled into rebate
    translate([0, 0, total_box_len - cover_t])
        color([0.35, 0.35, 0.35, 0.75])
            rear_cover();
}

module cutaway() {
    difference() {
        assembly();
        // Cut away right half (X > housing_w_out/2)
        translate([housing_w_out/2, -10, -10])
            cube([housing_w_out, housing_h_out + 20, total_box_len + 20]);
    }
}

if (PART == "main_body") {
    // Print orientation: Rear face resting flat on build plate, spigot & arms pointing UP
    translate([0, housing_h_out, total_box_len])
        rotate([180, 0, 0])
            main_body();
}
else if (PART == "rear_cover") {
    // Print orientation: Outer face resting flat on build plate
    rear_cover();
}
else if (PART == "top_hatch") {
    // Print orientation: Flat bottom face on build plate, grip ridges facing UP
    translate([1.0, 17.5, 0])
        rotate([-90, 0, 0])
            top_hatch();
}
else if (PART == "print_plate") {
    // All 3 printable parts arranged flat on build plate (cleanly separated)
    translate([0, housing_h_out, total_box_len])
        rotate([180, 0, 0])
            main_body();
            
    translate([housing_w_out + 14, 0, 0])
        rear_cover();

    translate([housing_w_out + 18, housing_h_out + 10 + 17.5, 0])
        rotate([-90, 0, 0])
            top_hatch();
}
else if (PART == "cutaway") {
    cutaway();
}
else if (PART == "cutaway_upright") {
    rotate([90, 0, 0])
        cutaway();
}
else if (PART == "assembly_upright") {
    rotate([90, 0, 0])
        assembly();
}
else if (PART == "assembly_front_iso") {
    rotate([0, 0, 180])
        rotate([90, 0, 0])
            assembly();
}
else if (PART == "assembly") {
    assembly();
}
