const sharp = require('sharp');
const pngToIco = require('png-to-ico');
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
  
  // Create multiple sizes for ICO
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    sizes.map(size => 
      sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );
  
  // Create ICO file
  const icoPath = path.join(assetsDir, 'icon.ico');
  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('✓ Created icon.ico (multi-size)');
  
  console.log('\n✅ All icons created successfully!');
}

createIcons().catch(err => {
  console.error('Error creating icons:', err);
  process.exit(1);
});
