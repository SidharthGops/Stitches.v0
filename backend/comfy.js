import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { removeBackground } from "./removeBg.js";

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

export const SERVER = (process.env.SERVER || 'http://127.0.0.1:8188').replace(/\/$/, '')
const resolveProjectPath = (value, fallbacks) => {
  const options = [value, ...fallbacks].filter(Boolean)
  for (const option of options) {
    if (path.isAbsolute(option) && fs.existsSync(option)) return option
    for (const base of [root, here, process.cwd()]) {
      const candidate = path.resolve(base, option)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  const first = options[0]
  return path.isAbsolute(first) ? first : path.resolve(root, first)
}
const tryOnWorkflowPath = resolveProjectPath(
  process.env.COMFY_TRYON_WORKFLOW_PATH || process.env.COMFY_WORKFLOW_PATH,
  [path.join('backend', 'workflows', 'stitches1.json'), path.join('workflows', 'stitches1.json')]
)
const avatarWorkflowPath = resolveProjectPath(
  process.env.COMFY_AVATAR_WORKFLOW_PATH,
  [path.join('backend', 'workflows', 'stitches2.json'), path.join('workflows', 'stitches2.json')]
)
const avatarDir = resolveProjectPath(
  process.env.AVATAR_DIR,
  [path.join('backend', 'assets', 'avatars'), path.join('assets', 'avatars')]
)
const tryOnOutputNode = process.env.COMFY_TRYON_OUTPUT_NODE || process.env.COMFY_OUTPUT_NODE || '94'
const avatarOutputNode = process.env.COMFY_AVATAR_OUTPUT_NODE || '43'
const presetAvatarSources = ['zishan', 'johnyyy', 'nikkus1', 'pavanayi']

export class ComfyError extends Error {
  constructor(message, status = 502, detail = '') {
    super(message)
    this.status = status
    this.detail = detail
  }
}

const fetchComfy = async (pathname, options = {}) => {
  let response
  try {
    response = await fetch(`${SERVER}${pathname}`, {
      ...options,
      headers: {
        'ngrok-skip-browser-warning': 'true',
        ...(options.headers || {})
      },
      signal: options.signal || AbortSignal.timeout(30_000)
    })
  } catch (error) {
    throw new ComfyError(`Could not reach the generation server at ${SERVER}.`, 503, error.message)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ComfyError(`Generation server returned ${response.status}.`, 502, detail.slice(0, 500))
  }
  return response
}

const resolvePresetAvatar = (avatarId) => {
  const match = /^preset-(\d{2})$/.exec(avatarId || '')
  if (!match) return avatarId
  const index = Number(match[1]) - 1
  return presetAvatarSources[index % presetAvatarSources.length]
}

const findAvatarPath = (avatarId) => {
  const resolvedAvatarId = resolvePresetAvatar(avatarId)
  const candidates = ['png', 'jpg', 'jpeg', 'webp'].map(ext => path.join(avatarDir, `${resolvedAvatarId}.${ext}`))
  const match = candidates.find(fs.existsSync)
  if (!match) {
    throw new ComfyError(`Avatar image "${avatarId}" is not configured. Add ${resolvedAvatarId}.png (or JPG/WEBP) to ${avatarDir}.`, 500)
  }
  return match
}

const loadWorkflow = (workflowFile) => {
  if (!fs.existsSync(workflowFile)) {
    throw new ComfyError(`ComfyUI workflow is missing. Export it to ${workflowFile}.`, 500)
  }
  try {
    return JSON.parse(fs.readFileSync(workflowFile, 'utf8'))
  } catch (error) {
    throw new ComfyError(`The ComfyUI workflow JSON could not be parsed: ${workflowFile}`, 500, error.message)
  }
}

const requireInput = (workflow, nodeId, inputName) => {
  if (!workflow[nodeId]?.inputs || !(inputName in workflow[nodeId].inputs)) {
    throw new ComfyError(`Workflow node ${nodeId}.inputs.${inputName} is missing.`, 500)
  }
}

export const uploadImage = async (buffer, filename) => {
  const form = new FormData()
  form.append('image', new Blob([buffer]), filename)
  const response = await fetchComfy('/upload/image', { method: 'POST', body: form })
  const payload = await response.json()
  if (!payload.name) throw new ComfyError('ComfyUI upload response did not include an image name.')
  return payload.name
}

const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

const setSeed = (workflow, nodeId) => {
  if (workflow[nodeId]?.inputs && 'noise_seed' in workflow[nodeId].inputs) {
    workflow[nodeId].inputs.noise_seed = randomSeed()
  }
}

const buildAvatarWorkflow = ({ gender, prompt }) => {
  const workflow = loadWorkflow(avatarWorkflowPath)
  requireInput(workflow, '10', 'text')
  requireInput(workflow, '11', 'text')
  workflow['10'].inputs.text = gender
  workflow['11'].inputs.text = prompt
  requireInput(workflow, '43', 'filename_prefix')
  workflow['43'].inputs.filename_prefix = 'Stitches_Custom_Avatar'
  setSeed(workflow, '33')
  return workflow
}

export const submitAvatarPrompt = async ({ prompt, promptParts }) => {
  if (!prompt?.trim()) throw new ComfyError('Avatar prompt is empty.', 400)
  for (const key of ['gender', 'prompt']) {
    if (!promptParts?.[key]?.trim()) throw new ComfyError(`Avatar prompt section "${key}" is empty.`, 400)
  }
  const gender = promptParts.gender.trim().toLowerCase()
  if (!['male', 'female'].includes(gender)) throw new ComfyError('Avatar gender must be male or female.', 400)
  const workflow = buildAvatarWorkflow({ gender, prompt: prompt.trim() })
  const response = await fetchComfy('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  const payload = await response.json()
  if (!payload.prompt_id) throw new ComfyError('ComfyUI queue response did not include a prompt_id.')
  return { promptId: payload.prompt_id, outputNode: avatarOutputNode, workflow: path.basename(avatarWorkflowPath) }
}

export const submitProject = async (project, garmentBuffer, garmentFilename, avatarFile) => {
  const workflow = loadWorkflow(tryOnWorkflowPath)
  requireInput(workflow, '76', 'image')
  requireInput(workflow, '81', 'image')
  requireInput(workflow, '135', 'text')
  setSeed(workflow, '125')

  const avatarPath = avatarFile ? null : findAvatarPath(project.selectedAvatar)
  const avatarBuffer = avatarFile?.buffer || fs.readFileSync(avatarPath)
  const avatarFilename = avatarFile?.filename || path.basename(avatarPath)
  let garmentToUpload = garmentBuffer;
  let garmentUploadName = garmentFilename;

  try {
    garmentToUpload = await removeBackground(garmentBuffer);
    garmentUploadName = "garment.png";
  } catch (err) {
  }
  const [avatarName, garmentName] = await Promise.all([
    uploadImage(avatarBuffer, avatarFilename),
    uploadImage(garmentToUpload, garmentUploadName)
  ]);
  workflow['76'].inputs.image = avatarName
  workflow['81'].inputs.image = garmentName
  if (project.prompt?.trim()) workflow['135'].inputs.text = project.prompt.trim()

  const response = await fetchComfy('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  const payload = await response.json()
  if (!payload.prompt_id) throw new ComfyError('ComfyUI queue response did not include a prompt_id.')
  return { promptId: payload.prompt_id, avatarName, garmentName, outputNode: tryOnOutputNode, workflow: path.basename(tryOnWorkflowPath) }
}

export const getProjectStatus = async (promptId, nodeId) => {
  if (!nodeId) throw new ComfyError('No ComfyUI output node was configured for this job.', 500)
  const response = await fetchComfy(`/history/${encodeURIComponent(promptId)}`)
  const history = await response.json()
  const result = history[promptId]
  if (!result) return { status: 'processing' }
  if (result.status?.status_str === 'error') {
    throw new ComfyError('ComfyUI could not generate this image.', 502, JSON.stringify(result.status).slice(0, 500))
  }
  const output = result.outputs?.[nodeId]?.images?.[0]
  if (!output) throw new ComfyError(`ComfyUI finished without an image from output node ${nodeId}.`, 502)
  return {
    status: 'complete',
    output: { filename: output.filename, subfolder: output.subfolder || '', type: output.type || 'output' }
  }
}

export const fetchResultImage = async (output) => {
  const params = new URLSearchParams({
    filename: output.filename,
    subfolder: output.subfolder || '',
    type: output.type || 'output'
  })
  return fetchComfy(`/view?${params.toString()}`)
}

export const workflowConfig = {
  avatar: {
    path: avatarWorkflowPath,
    outputNode: avatarOutputNode,
    promptNodes: { gender: '10', prompt: '11' }
  },
  tryOn: {
    path: tryOnWorkflowPath,
    outputNode: tryOnOutputNode,
    imageNodes: { avatar: '76', garment: '81' },
    promptNode: '135'
  }
}
