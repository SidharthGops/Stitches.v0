import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(here, '.env')

if (fs.existsSync(envPath)) {
    try {
        process.loadEnvFile(envPath)
    } catch (err) {
        console.warn(`⚠️  Could not load ${envPath}:`, err.message)
    }
} else {
    console.warn(`⚠️  No .env file found at ${envPath} — using defaults/fallbacks.`)
}