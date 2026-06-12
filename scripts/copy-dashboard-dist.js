import fs from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve('src/dashboard/dist')
const destDir = path.resolve('dist/src/dashboard/dist')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

if (fs.existsSync(srcDir)) {
  copyDir(srcDir, destDir)
  console.log('✅ [build] Successfully copied dashboard UI dist to root dist.')
} else {
  console.error('❌ [build] Source dashboard UI dist not found. Build the UI first.')
  process.exit(1)
}

// Copy package.json to dist/package.json
fs.copyFileSync('package.json', 'dist/package.json')
console.log('✅ [build] Successfully copied package.json to dist/package.json')
