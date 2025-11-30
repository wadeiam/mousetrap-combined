#!/usr/bin/env node

/**
 * MouseTrap Monitor - Icon Generation Script (Node.js)
 *
 * This script uses sharp (if available) or provides instructions for manual conversion
 * Run: node generate-icons.js
 *
 * If sharp is not installed:
 * npm install -g sharp-cli
 * or
 * npx sharp-cli --help
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ASSETS_DIR = __dirname;

console.log('=== MouseTrap Monitor Icon Generator ===\n');

// Check if SVG source files exist
const iconSvg = path.join(ASSETS_DIR, 'icon-source.svg');
const notificationSvg = path.join(ASSETS_DIR, 'notification-icon-source.svg');

if (!fs.existsSync(iconSvg)) {
    console.error('Error: icon-source.svg not found!');
    process.exit(1);
}

if (!fs.existsSync(notificationSvg)) {
    console.error('Error: notification-icon-source.svg not found!');
    process.exit(1);
}

console.log('✓ Found SVG source files\n');

// Try to use sharp-cli if available
try {
    execSync('sharp --version', { stdio: 'ignore' });
    console.log('Using sharp-cli for conversion...\n');

    // Convert main icon to various sizes
    const conversions = [
        { input: iconSvg, output: 'icon.png', size: 1024 },
        { input: iconSvg, output: 'adaptive-icon.png', size: 1024 },
        { input: iconSvg, output: 'splash-icon.png', size: 1024 },
        { input: iconSvg, output: 'favicon.png', size: 48 },
        { input: notificationSvg, output: 'notification-icon.png', size: 96 }
    ];

    conversions.forEach(({ input, output, size }) => {
        const outputPath = path.join(ASSETS_DIR, output);
        try {
            execSync(`sharp -i "${input}" -o "${outputPath}" resize ${size} ${size}`, {
                stdio: 'inherit'
            });
            console.log(`  ✓ Generated ${output} (${size}x${size})`);
        } catch (error) {
            console.error(`  ✗ Failed to generate ${output}`);
        }
    });

    console.log('\n=== Icon generation complete! ===\n');

} catch (error) {
    console.log('sharp-cli not found. Trying alternative methods...\n');

    // Try using cairosvg if available (Python)
    try {
        execSync('cairosvg --version', { stdio: 'ignore' });
        console.log('Using cairosvg for conversion...\n');

        const conversions = [
            { input: iconSvg, output: 'icon.png', size: 1024 },
            { input: iconSvg, output: 'adaptive-icon.png', size: 1024 },
            { input: iconSvg, output: 'splash-icon.png', size: 1024 },
            { input: iconSvg, output: 'favicon.png', size: 48 },
            { input: notificationSvg, output: 'notification-icon.png', size: 96 }
        ];

        conversions.forEach(({ input, output, size }) => {
            const outputPath = path.join(ASSETS_DIR, output);
            try {
                execSync(`cairosvg "${input}" -o "${outputPath}" -W ${size} -H ${size}`, {
                    stdio: 'inherit'
                });
                console.log(`  ✓ Generated ${output} (${size}x${size})`);
            } catch (error) {
                console.error(`  ✗ Failed to generate ${output}`);
            }
        });

        console.log('\n=== Icon generation complete! ===\n');

    } catch (error2) {
        // No conversion tools available, provide manual instructions
        console.log('No automated conversion tools found.\n');
        console.log('=== Manual Conversion Instructions ===\n');
        console.log('Option 1: Use the HTML preview tool');
        console.log('  1. Open preview-icons.html in your browser:');
        console.log('     open preview-icons.html');
        console.log('  2. Click the download buttons for each icon\n');

        console.log('Option 2: Install sharp-cli');
        console.log('  npm install -g sharp-cli');
        console.log('  Then run this script again\n');

        console.log('Option 3: Install cairosvg (Python)');
        console.log('  pip install cairosvg');
        console.log('  Then run this script again\n');

        console.log('Option 4: Use online converter');
        console.log('  1. Go to https://svgtopng.com/');
        console.log('  2. Upload icon-source.svg');
        console.log('  3. Download at 1024x1024');
        console.log('  4. Save as icon.png, adaptive-icon.png, splash-icon.png');
        console.log('  5. Repeat for notification-icon-source.svg (96x96)\n');

        console.log('Option 5: Use macOS Preview');
        console.log('  1. Open icon-source.svg in Preview');
        console.log('  2. File > Export > PNG, Size: 1024x1024');
        console.log('  3. Save as icon.png (and copy for adaptive-icon.png, splash-icon.png)');
        console.log('  4. Repeat for notification icon at 96x96\n');

        console.log('After generating PNGs, run:');
        console.log('  npx expo prebuild --clean\n');
    }
}

// List current icons
console.log('Current icon files:');
const iconFiles = [
    'icon.png',
    'adaptive-icon.png',
    'splash-icon.png',
    'favicon.png',
    'notification-icon.png'
];

iconFiles.forEach(file => {
    const filePath = path.join(ASSETS_DIR, file);
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`  ✓ ${file} (${Math.round(stats.size / 1024)}KB)`);
    } else {
        console.log(`  ✗ ${file} (missing)`);
    }
});

console.log('\nFor more info, see: ICONS-README.md\n');
