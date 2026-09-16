// ==============================================================================
// SMART MOUSETRAP - MINIMAL OUTLINE TEST-FIT GAUGES
// Fast, low-filament calibration prints to verify physical fits before full print
// ==============================================================================
// 1. Trap Interface Gauge: ~12 min print, ~7g filament
//    - Tests spigot fit into clear acrylic tunnel (59.0 x 72.0 mm)
//    - Tests top roof notch catch tab
//    - Tests side cantilever snap arms & loop engagement
//    - Features generous bottom cutout to clear jutting black piece & baseplate!
// 2. PCB & Sensor Test Plate: ~8 min print, ~5g filament
//    - Tests M3 diagonal standoff spacing: (4.69, 4.20) and (58.16, 61.63)
//    - Tests OV2640 camera snap pocket & lens aperture
//    - Tests TOF050C sensor M2 screw bosses & optical snout window
// 3. Top Hatch Dovetail Gauge: ~5 min print, ~3g filament
//    - Tests sliding fit of USB access hatch door in guide rails
// ==============================================================================

$fn = 40;

// Trap Tunnel Dimensions (Updated from physical test fit feedback)
height_trim      = 2.00;  // Trimmed 2.00mm total (was 1.25mm; lowered ceiling by 0.75mm per Wade's instruction)
trap_w_in        = 59.50; // Clear tunnel inner width
trap_w_out       = 62.00; // Clear tunnel outer width
trap_h_in        = 72.60 - height_trim; // 70.60mm inner tunnel height
trap_h_out       = 74.67 - height_trim; // 72.67mm outer tunnel height

// Spigot & Snap Arm Dimensions (Caliper-Verified from IMG_6354 & IMG_6363 + Fit Feedback)
spigot_w_out     = 59.00; // Outer width of spigot (0.5mm total clearance)
spigot_total_h   = 74.00 - height_trim; // 72.00mm outer height from Y=0 (lowered ceiling by 0.75mm)
spigot_len       = 15.05; // Total depth from collar shoulder to front tip (IMG_6354: 15.05mm)
spigot_sleeve_len= 10.00; // Front sleeve length that slides inside clear trap (IMG_6390: 10.0mm insertion)
step_len         = spigot_len - spigot_sleeve_len; // 5.05mm stepped section before collar
step_t           = 0.90;  // Thickness step-up (0.9mm per side and top to butt squarely against clear trap edge)
spigot_wall_t    = 1.40;  // Spigot wall thickness
collar_depth     = 5.00;  // Rear collar depth past shoulder

wall_t           = 2.00;
housing_w_out    = 70.62;
housing_h_out    = 78.67 - height_trim; // 76.67mm outer collar height (lowered ceiling by 0.75mm)
spigot_x_off     = (housing_w_out - spigot_w_out)/2; // 5.81mm
spigot_y_off     = wall_t;                           // 2.00mm
spigot_h_out     = spigot_total_h - spigot_y_off;    // 70.00mm

clip_w           = 20.08; // Arm vertical height (IMG_6346: 20.08mm)
clip_t           = 1.80;  // Arm beam thickness (sleek 1.80mm, matches original molded clip)
arm_y            = 17.00; // Moved UP 1.0mm per test fit (was 16.00mm, preserves height below)
gap              = 3.35;  // Gap between spigot and arm (moved outward 1.0mm each side per Wade's instruction)
hook_h           = 1.20;  // Outward snap hook protrusion with 90-deg mechanical retaining shelf (matches original IMG_6407)
arm_root_len     = collar_depth; // Rooted in collar
clip_z_shift     = 2.45;  // Shift clips & tab 2.45mm rearward so trap body seats flush against 10mm step (IMG_6394-6398)
arm_free_len     = spigot_len - clip_z_shift; // 12.60mm free cantilever beam length

// Top roof latch tab dimensions (IMG_6388 & IMG_6389 comparison)
tab_w            = 4.40;  // Narrowed from 7.00mm to 4.40mm to match original notch
tab_h            = 2.20;  // Increased from 1.20mm to 2.20mm to stick up properly into clear trap roof cutout
tab_ramp_l       = 2.50;  // Lead-in entry ramp
tab_flat_l       = 1.00;  // Flat crest before vertical catch drop
tab_total_l      = tab_ramp_l + tab_flat_l; // 3.50mm total tab length along Z

// Bottom Cutout for Jutting Black Box & Baseplate (IMG_6363: 22.70mm height)
bottom_cutout_w  = spigot_w_out + 2.0; // Full width clearance
bottom_cutout_h  = 24.00;              // Clears 22.70mm high jutting black box with 1.3mm margin


// ------------------------------------------------------------------------------
// PART SELECTION
// ------------------------------------------------------------------------------
PART = "trap_interface"; // Options: "trap_interface", "pcb_sensor_plate", "top_hatch_gauge", "all_gauges"

// ==============================================================================
// 1. TRAP INTERFACE TEST GAUGE
// ==============================================================================
module trap_interface_gauge() {
    difference() {
        union() {
            // A. Collar / Shoulder Stop (Z = 0 to collar_depth)
            translate([0, 0, 0])
                cube([housing_w_out, housing_h_out, collar_depth]);

            // B. Mating Spigot:
            // B1. Front thin sleeve that enters clear tunnel (Z = -spigot_len to -step_len, 10.0mm long)
            translate([spigot_x_off, 0, -spigot_len])
                cube([spigot_w_out, spigot_h_out + spigot_y_off, spigot_sleeve_len]);

            // B2. Stepped sleeve depth stop (Z = -step_len to 0, 5.05mm long)
            // Steps UP by step_t (0.90mm) on left, right, and top to butt squarely against clear trap edge!
            translate([spigot_x_off - step_t, 0, -step_len])
                cube([spigot_w_out + 2*step_t, spigot_h_out + spigot_y_off + step_t, step_len]);

            // C. Top Catch Tab (on top of spigot, engages clear trap roof notch)
            // Shifted rearward by clip_z_shift (2.45mm) to seat clear trap body flush against 10mm step
            translate([housing_w_out/2, spigot_y_off + spigot_h_out, -spigot_len + 1.2 + clip_z_shift]) {
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

            // D. Side Cantilever Snap Arms (Left & Right)
            // Left Arm - Shifted rearward by clip_z_shift (2.45mm) to seat clear trap body flush against 10mm step
            arm_l_x = spigot_x_off - gap - clip_t;
            translate([arm_l_x, arm_y, -spigot_len + clip_z_shift]) {
                // Continuous Cantilever Beam from front tip into collar
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
            }

            // Right Arm - Shifted rearward by clip_z_shift (2.45mm) to seat clear trap body flush against 10mm step
            arm_r_x = spigot_x_off + spigot_w_out + gap;
            translate([arm_r_x, arm_y, -spigot_len + clip_z_shift]) {
                // Continuous Cantilever Beam from front tip into collar
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
            }
        }

        // --- SUBTRACTIONS ---
        // 1. Hollow Center Through Entire Gauge
        translate([spigot_x_off + spigot_wall_t, spigot_y_off + spigot_wall_t, -spigot_len - 1.0])
            cube([spigot_w_out - 2*spigot_wall_t, spigot_h_out - 2*spigot_wall_t, spigot_len + collar_depth + 2.0]);

        // 2. Cantilever Arm Flexure Relief in Collar
        rel_gap = 1.20;
        arm_l_x = spigot_x_off - gap - clip_t;
        arm_r_x = spigot_x_off + spigot_w_out + gap;
        // Left reliefs
        translate([-0.5, arm_y - rel_gap, -0.1])
            cube([arm_l_x + 0.5, clip_w + 2*rel_gap, collar_depth + 0.2]);
        translate([arm_l_x + clip_t, arm_y - 0.2, -0.1])
            cube([gap + 0.1, clip_w + 0.4, collar_depth + 0.2]);
        // Right reliefs
        translate([arm_r_x + clip_t, arm_y - rel_gap, -0.1])
            cube([housing_w_out - (arm_r_x + clip_t) + 0.5, clip_w + 2*rel_gap, collar_depth + 0.2]);
        translate([spigot_x_off + spigot_w_out - 0.1, arm_y - 0.2, -0.1])
            cube([gap + 0.1, clip_w + 0.4, collar_depth + 0.2]);

        // 4. CRITICAL: BOTTOM CLEARANCE CUTOUT FOR JUTTING BLACK BOX & BASEPLATE!
        // Cuts open the bottom between the spigot side walls from Z = -spigot_len to collar_depth,
        // preserving the lower spigot flanges that slide between the bait tray and clear trap body!
        translate([spigot_x_off + spigot_wall_t, -1.0, -spigot_len - 1.0])
            cube([spigot_w_out - 2*spigot_wall_t, bottom_cutout_h + 1.0, spigot_len + collar_depth + 2.0]);
    }
}


// ==============================================================================
// 2. PCB & SENSOR CALIBRATION TEST PLATE
// ==============================================================================
module pcb_sensor_plate() {
    plate_w = 65.42; // KiCad PCB width
    plate_h = 67.02; // KiCad PCB height
    plate_t = 2.00;  // Base plate thickness
    
    // Coordinates relative to plate origin
    h1_x = 4.69;  h1_y = 4.20;   // M3 Bottom-Left
    h2_x = 58.16; h2_y = 61.63;  // M3 Top-Right
    
    // Sensor Positions
    cam_x = 32.71; cam_y = 51.00; // Dead center X
    tof_x = 32.71; tof_y = 34.30; // Dead center X, vertically centered in tunnel
    flash_x = 15.77; flash_y = 35.91;
    
    difference() {
        union() {
            // Main Plate Base
            cube([plate_w, plate_h, plate_t]);
            
            // Standoff Bosses for PCB M3 screws (3.0mm tall)
            for (pt = [[h1_x, h1_y], [h2_x, h2_y]]) {
                translate([pt[0], pt[1], plate_t])
                    cylinder(d=6.5, h=3.0);
            }
            
            // Camera Module Retention Pocket Walls (Holds 8.5x8.5mm OV2640)
            translate([cam_x - 5.5, cam_y - 5.5, plate_t]) {
                difference() {
                    cube([11.0, 11.0, 4.0]);
                    translate([1.2, 1.2, -0.1])
                        cube([8.6, 8.6, 4.2]);
                    // Ribbon cable exit notch
                    translate([1.2 + 1.3, -0.5, 0.5])
                        cube([6.0, 2.5, 4.0]);
                }
                // Retention lip
                translate([1.2, 1.2 + 8.6 - 0.7, 3.2])
                    cube([8.6, 0.7, 0.8]);
            }
            
            // ToF Sensor M2 Screw Bosses (spaced 15.5mm)
            for (dx = [-15.5/2, 15.5/2]) {
                translate([tof_x + dx, tof_y, plate_t])
                    difference() {
                        cylinder(d=4.5, h=3.5);
                        translate([0, 0, -0.5])
                            cylinder(d=1.8, h=4.5);
                    }
            }
            // ToF Alignment Guide Ribs
            translate([tof_x - 10.2, tof_y - 5.7 - 1.0, plate_t])
                cube([20.4, 1.0, 3.0]);
            translate([tof_x - 10.2, tof_y + 5.7, plate_t])
                cube([20.4, 1.0, 3.0]);
        }
        
        // --- SUBTRACTIONS ---
        // 1. M3 Screw Holes through Standoffs
        for (pt = [[h1_x, h1_y], [h2_x, h2_y]]) {
            translate([pt[0], pt[1], -0.5])
                cylinder(d=3.2, h=plate_t + 4.0);
        }
        
        // 2. Camera Lens Aperture Hole
        translate([cam_x, cam_y, -0.5])
            cylinder(d=7.2, h=plate_t + 1.0);
            
        // 3. ToF Oval Optical Snout Aperture
        translate([tof_x, tof_y, -0.5])
            hull() {
                translate([-3.0, 0, 0]) cylinder(d=6.5, h=plate_t + 1.0);
                translate([3.0, 0, 0])  cylinder(d=6.5, h=plate_t + 1.0);
            }
            
        // 4. Flash LED Hole
        translate([flash_x, flash_y, -0.5])
            cylinder(d=8.0, h=plate_t + 1.0);
            
        // 5. Identification Embossing
        translate([plate_w/2 - 18, 5.0, plate_t - 0.6])
            linear_extrude(1.0)
                text("PCB-SENSOR GAUGE", size=3.0);
    }
}


// ==============================================================================
// 3. TOP HATCH DOVETAIL SLIDE GAUGE
// ==============================================================================
module top_hatch_gauge() {
    rail_w = 28.5;
    rail_l = 15.0;
    
    // Rail Test Block
    difference() {
        cube([rail_w + 6.0, 4.0, rail_l]);
        // Center port cutout
        translate([5.0, -0.5, -0.5])
            cube([rail_w - 4.0, 5.0, rail_l + 1.0]);
        // Left dovetail groove
        translate([3.0 + 0.8, 1.8, -0.5])
            cube([1.6, 1.4, rail_l + 1.0]);
        // Right dovetail groove
        translate([3.0 + rail_w - 2.2 - 0.2, 1.8, -0.5])
            cube([1.6, 1.4, rail_l + 1.0]);
    }
    
    // Matching Hatch Door (Positioned next to rails on build plate)
    translate([rail_w + 12.0, 0, 0]) {
        difference() {
            union() {
                cube([27.2, 1.4, 14.0]);
                // Left & right tongues
                translate([-0.9, 0.2, 0])
                    cube([0.9, 1.0, 14.0]);
                translate([27.2, 0.2, 0])
                    cube([0.9, 1.0, 14.0]);
                // Grip ridges
                for (i = [0:2]) {
                    translate([5.0 + i*6.0, 1.4, 3.0])
                        cube([2.5, 0.8, 8.0]);
                }
            }
            // ID
            translate([8.0, 0.8, 1.0])
                rotate([90, 0, 0])
                    linear_extrude(1.0)
                        text("HATCH", size=2.5);
        }
    }
}


// ==============================================================================
// RENDER & EXPORT LOGIC
// ==============================================================================
if (PART == "trap_interface") {
    // Print orientation: Collar resting flat on build plate, spigot pointing UP!
    // Requires NO SUPPORTS!
    translate([0, housing_h_out, 0])
        rotate([180, 0, 0])
            trap_interface_gauge();
}
else if (PART == "pcb_sensor_plate") {
    // Print orientation: Flat on bed
    pcb_sensor_plate();
}
else if (PART == "top_hatch_gauge") {
    // Print orientation: Flat on bed
    top_hatch_gauge();
}
else if (PART == "all_gauges") {
    // Arranged side-by-side on build plate
    translate([0, housing_h_out, 0])
        rotate([180, 0, 0])
            trap_interface_gauge();
            
    translate([housing_w_out + 10, 0, 0])
        pcb_sensor_plate();
        
    translate([housing_w_out + 10, 75, 0])
        top_hatch_gauge();
}
