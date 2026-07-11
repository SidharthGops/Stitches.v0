import './env.js'
import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { ComfyError, SERVER, fetchResultImage, getProjectStatus, submitAvatarPrompt, submitProject, workflowConfig } from './comfy.js'
import { logGeneration, logRating } from './generationLog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const avatarsDir = path.join(here, 'assets', 'avatars')
const PORT = Number(process.env.PORT || 8787)
const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS !== 'false'
const normalizeOrigin = (value) => {
  const origin = String(value || '').trim().replace(/\/+$/, '')
  if (!origin) return ''
  return /^https?:\/\//i.test(origin) ? origin : `https://${origin}`
}
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  normalizeOrigin(process.env.FRONTEND_URL),
  normalizeOrigin(process.env.VERCEL_URL),
  ...String(process.env.FRONTEND_ORIGINS || '').split(',').map(normalizeOrigin)
].filter(Boolean))
const isAllowedOrigin = (origin) => {
  if (!origin) return true
  if (allowedOrigins.has(origin)) return true
  if (!allowVercelPreviews) return false
  try {
    return new URL(origin).hostname.endsWith('.vercel.app')
  } catch {
    return false
  }
}

// Everything lives in memory only. Nothing is written to disk, so there's no
// projects.json and no uploads folder to go stale or need clearing — a
// restart of the process wipes all state cleanly.
const projects = {}
const garmentFiles = {} // projectId -> { buffer, mimetype, originalname }
const avatarJobs = {}
const generatedAvatars = {} // custom avatar id -> { buffer, mimetype, prompt, createdAt }
const pendingLogAssets = {} // projectId -> { avatarBuffer, avatarMimetype, garmentBuffer, garmentMimetype } — held only until logging fires, never sent to the frontend

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/i.test(file.mimetype))
})

const app = express()
app.use((req, res, next) => {
  const origin = req.get('origin')
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
  } else if (req.method === 'OPTIONS') {
    return res.status(403).json({ error: 'This origin is not allowed.' })
  }

  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '1mb' }))
app.use('/avatars', express.static(avatarsDir))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'stitches-api', time: new Date().toISOString() })
})

// Serves the in-memory garment buffer instead of a static uploads directory.
app.get('/uploads/:id', (req, res) => {
  const file = garmentFiles[req.params.id]
  if (!file) return res.status(404).end()
  res.set({ 'Content-Type': file.mimetype, 'Cache-Control': 'private, max-age=3600' })
  res.send(file.buffer)
})

const cleanPart = (value, fallback = '') => String(value || fallback).trim().replace(/\s+/g, ' ').slice(0, 180)
const extensionFromType = (type = '') => {
  if (type.includes('jpeg')) return 'jpg'
  if (type.includes('webp')) return 'webp'
  return 'png'
}

const buildAvatarPromptParts = (input = {}) => {
  const rawGender = cleanPart(input.gender || input.genderPresentation || 'female').toLowerCase()
  const gender = rawGender.includes('male') && !rawGender.includes('female') ? 'male' : 'female'
  const age = cleanPart(input.age, 'mid 20s')
  const ethnicity = cleanPart(input.ethnicity, 'globally ambiguous')
  const skinTone = cleanPart(input.skinTone, 'natural medium skin tone')
  const genderPresentation = cleanPart(input.genderPresentation, 'fashion model')
  const bodyType = cleanPart(input.bodyType, 'average build')
  const hair = cleanPart(input.hair, 'natural hair, neatly styled')
  const expression = cleanPart(input.expression, 'calm confident expression')
  const pose = cleanPart(input.pose, 'relaxed front-facing pose')
  const style = cleanPart(input.style, 'minimal contemporary styling')
  const background = cleanPart(input.background, 'seamless white studio')
  const keywords = cleanPart(input.keywords)

  const prompt = [
    `A realistic full-body studio avatar of a ${age} ${ethnicity} ${genderPresentation}.`,
    `Skin tone: ${skinTone}. Body type: ${bodyType}. Hair: ${hair}.`,
    keywords ? `Creative identity keywords: ${keywords}.` : '',
    `${pose}.`,
    `${expression}.`,
    'Simple fitted neutral base outfit for avatar generation only.',
    'Minimal accessories, clean clothing silhouette, ready for garment replacement in the try-on stage.',
    `${background}.`,
    'Clean minimal backdrop, even soft diffused lighting, no harsh shadows, full-body framing with margin above head and below feet.',
    `${style}.`,
    'Photorealistic editorial fashion catalog style, sharp focus, high detail, natural lighting, vertical full-body composition, no text, no logos, no watermark, no extra limbs.'
  ].filter(Boolean).join(' ')

  return {
    gender,
    prompt
  }
}

const joinAvatarPrompt = (parts) => parts.prompt

const publicWorkflowConfig = () => ({
  avatar: {
    workflow: path.basename(workflowConfig.avatar.path),
    outputNode: workflowConfig.avatar.outputNode,
    promptNodes: workflowConfig.avatar.promptNodes
  },
  tryOn: {
    workflow: path.basename(workflowConfig.tryOn.path),
    outputNode: workflowConfig.tryOn.outputNode,
    imageNodes: workflowConfig.tryOn.imageNodes,
    promptNode: workflowConfig.tryOn.promptNode
  }
})

const avatarJobResponse = (job) => ({
  avatarJobId: job.id,
  status: job.status,
  prompt: job.prompt,
  promptParts: job.promptParts,
  workflow: job.workflow,
  outputNode: job.outputNode
})

app.get('/api/workflows', (_req, res) => {
  res.json(publicWorkflowConfig())
})

app.get('/api/avatars/custom/:id', (req, res) => {
  const avatar = generatedAvatars[req.params.id]
  if (!avatar) return res.status(404).end()
  res.set({ 'Content-Type': avatar.mimetype, 'Cache-Control': 'private, max-age=3600' })
  res.send(avatar.buffer)
})

app.post('/api/avatars/generate', async (req, res, next) => {
  try {
    const promptParts = buildAvatarPromptParts(req.body)
    const prompt = joinAvatarPrompt(promptParts)
    const queued = await submitAvatarPrompt({ prompt, promptParts })
    avatarJobs[queued.promptId] = {
      id: queued.promptId,
      prompt,
      promptParts,
      status: 'queued',
      workflow: queued.workflow,
      outputNode: queued.outputNode,
      createdAt: new Date().toISOString()
    }
    res.status(202).json(avatarJobResponse(avatarJobs[queued.promptId]))
  } catch (error) {
    next(error)
  }
})

app.get('/api/avatars/generate/:id/status', async (req, res, next) => {
  const job = avatarJobs[req.params.id]
  if (!job) return res.status(404).json({ error: 'Avatar generation job not found.' })
  if (job.status === 'complete' && job.avatarId) {
    return res.json({
      ...avatarJobResponse(job),
      status: 'complete',
      avatar: {
        id: job.avatarId,
        name: 'Custom avatar',
        note: 'AI generated',
        image: `/api/avatars/custom/${job.avatarId}`,
        prompt: job.prompt
      }
    })
  }

  try {
    const result = await getProjectStatus(job.id, job.outputNode)
    job.status = result.status
    if (result.status !== 'complete') return res.json(avatarJobResponse(job))

    const image = await fetchResultImage(result.output)
    const mimetype = image.headers.get('content-type') || 'image/png'
    const buffer = Buffer.from(await image.arrayBuffer())
    const avatarId = `custom-${randomUUID()}`
    generatedAvatars[avatarId] = {
      buffer,
      mimetype,
      prompt: job.prompt,
      createdAt: new Date().toISOString()
    }
    job.avatarId = avatarId
    job.status = 'complete'
    res.json({
      ...avatarJobResponse(job),
      status: 'complete',
      avatar: {
        id: avatarId,
        name: 'Custom avatar',
        note: 'AI generated',
        image: `/api/avatars/custom/${avatarId}`,
        prompt: job.prompt
      }
    })
  } catch (error) {
    job.status = 'failed'
    job.error = error.message
    next(error)
  }
})

app.post('/api/projects', upload.single('garment'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please upload a PNG, JPG, or WEBP garment image.' })
  const id = randomUUID()
  garmentFiles[id] = { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname }
  const project = {
    id,
    garmentName: req.file.originalname,
    garmentUrl: `/uploads/${id}`,
    selectedAvatar: null,
    prompt: '',
    status: 'draft',
    createdAt: new Date().toISOString()
  }
  projects[id] = project
  res.status(201).json(project)
})

app.get('/api/projects/:id', (req, res) => {
  const project = projects[req.params.id]
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  res.json(project)
})

app.patch('/api/projects/:id', (req, res) => {
  const project = projects[req.params.id]
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  if ('feedback' in req.body) {
    const value = req.body.feedback
    const isValidRating = value === null || (Number.isInteger(value) && value >= 1 && value <= 10)
    if (!isValidRating) return res.status(400).json({ error: 'Feedback must be an integer from 1 to 10, or null.' })
  }
  const allowed = ['selectedAvatar', 'selectedAvatarName', 'avatarPrompt', 'customAvatars', 'prompt', 'feedback']
  for (const key of allowed) if (key in req.body) project[key] = req.body[key]
  project.updatedAt = new Date().toISOString()
  if ('feedback' in req.body && req.body.feedback !== null) {
    logRating(project.logId, req.body.feedback) // best-effort, not awaited — never blocks the response
  }
  res.json(project)
})

app.post('/api/projects/:id/generate', async (req, res, next) => {
  const project = projects[req.params.id]
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  if (!project.selectedAvatar) {
    return res.status(400).json({ error: 'Choose an avatar first.' })
  }
  if (project.promptId && ['queued', 'processing'].includes(project.status)) return res.json(project)

  try {
    const file = garmentFiles[project.id]
    if (!file) return res.status(410).json({ error: 'The uploaded garment image is no longer available.' })
    let avatarFile = null
    if (project.selectedAvatar?.startsWith('custom-')) {
      const avatar = generatedAvatars[project.selectedAvatar]
      if (!avatar) return res.status(410).json({ error: 'The custom avatar is no longer available. Please create it again.' })
      avatarFile = {
        buffer: avatar.buffer,
        filename: `${project.selectedAvatar}.${extensionFromType(avatar.mimetype)}`
      }
    }
    const queued = await submitProject(project, file.buffer, file.originalname, avatarFile, file.mimetype)
    project.promptId = queued.promptId
    project.comfyInputs = { avatar: queued.avatarName, garment: queued.garmentName }
    project.comfyWorkflow = queued.workflow
    project.comfyOutputNode = queued.outputNode
    project.status = 'queued'
    project.queuedAt = new Date().toISOString()
    project.error = null
    project.feedback = null
    project.logId = null // reset so a regenerated result gets logged as its own row
    pendingLogAssets[project.id] = {
      avatarBuffer: queued.avatarBuffer,
      avatarMimetype: queued.avatarMimetype,
      garmentBuffer: queued.garmentLogBuffer,
      garmentMimetype: queued.garmentLogMimetype
    }
    res.status(202).json(project)
  } catch (error) {
    project.status = 'failed'
    project.error = error.message
    next(error)
  }
})

app.get('/api/projects/:id/status', async (req, res, next) => {
  const project = projects[req.params.id]
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  if (!project.promptId) return res.status(409).json({ error: 'This project has not been queued.' })
  if (project.status === 'complete') return res.json(project)

  try {
    const result = await getProjectStatus(project.promptId, project.comfyOutputNode || workflowConfig.tryOn.outputNode)
    project.status = result.status
    if (result.status === 'complete') {
      project.comfyOutput = result.output
      project.completedAt = new Date().toISOString()
      project.resultUrl = `/api/projects/${project.id}/result?v=${Date.now()}`

      const assets = pendingLogAssets[project.id]
      if (assets && !project.logId) {
        delete pendingLogAssets[project.id] // claim it once, so a fast double-poll can't log twice
        fetchResultImage(result.output)
          .then(async (image) => {
            const resultMimetype = image.headers.get('content-type') || 'image/png'
            const resultBuffer = Buffer.from(await image.arrayBuffer())
            const logId = await logGeneration({
              id: project.id,
              avatarBuffer: assets.avatarBuffer,
              avatarMimetype: assets.avatarMimetype,
              garmentBuffer: assets.garmentBuffer,
              garmentMimetype: assets.garmentMimetype,
              resultBuffer,
              resultMimetype
            })
            if (logId) project.logId = logId
          })
          .catch((error) => console.error('generation logging failed —', error.message))
      }
    }
    res.json(project)
  } catch (error) {
    project.status = 'failed'
    project.error = error.message
    next(error)
  }
})

app.get('/api/projects/:id/result', async (req, res, next) => {
  const project = projects[req.params.id]
  if (!project) return res.status(404).json({ error: 'Project not found.' })
  if (!project.comfyOutput) return res.status(409).json({ error: 'The generated image is not ready yet.' })
  try {
    const image = await fetchResultImage(project.comfyOutput)
    const contentType = image.headers.get('content-type') || 'image/png'
    const bytes = Buffer.from(await image.arrayBuffer())
    res.set({ 'Content-Type': contentType, 'Content-Length': bytes.length, 'Cache-Control': 'private, max-age=3600' })
    res.send(bytes)
  } catch (error) {
    next(error)
  }
})

const dist = path.join(root, 'frontend', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be smaller than 10 MB.' : err.message })
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' })
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Request body must be valid JSON.' })
  if (err instanceof ComfyError) return res.status(err.status).json({ error: err.message, detail: err.detail || undefined })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
})

app.listen(PORT, () => {
  console.log(`Stitches API ready at http://localhost:${PORT}`)
  console.log(`ComfyUI server: ${SERVER}`)
  if (/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(SERVER)) {
    console.warn(
      '⚠️  SERVER is falling back to localhost. If this is deployed (e.g. Render), ' +
      'the SERVER environment variable is missing or empty in the dashboard — ' +
      'set it to your current ngrok URL. Remember free ngrok URLs change on every restart.'
    )
  }
})