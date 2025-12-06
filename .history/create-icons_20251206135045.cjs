const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'electron', 'assets', 'icon.svg');
const assetsDir = path.join(__dirname, 'electron', 'assets');

async function createIcons() {
  console.log('Creating icons from SVG...');
  
  // Read SVG
  const svgBuffer = fs.readFileSync(svgPath);
  
  // Create PNG at 256x256
  const pngPath = path.join(assetsDir, 'icon.png');
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(pngPath);
  console.log('✓ Created icon.png (256x256)');
  
  // Create multiple PNG sizes for electron-builder to use
  const sizes = [16, 32, 48, 64, 128, 256];
  for (const size of sizes) {
    const sizePath = path.join(assetsDir, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(sizePath);
  }
  console.log('✓ Created multi-size PNGs');
  
  // Copy the 256 PNG as icon.ico placeholder (electron-builder will handle conversion)
  fs.copyFileSync(pngPath, path.join(assetsDir, 'icon.ico'));
  console.log('✓ Created icon.ico placeholder');
  
  console.log('\n✅ All icons created successfully!');
}

createIcons().catch(err => {
  console.error('Error creating icons:', err);
  process.exit(1);
});
