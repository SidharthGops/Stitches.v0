import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Download, ImagePlus, RotateCcw, Sparkles, Upload, WandSparkles, X } from 'lucide-react'
import { apiFetch, assetUrl } from './api.js'

const stages = [
  { path: '/create/upload', label: 'Garment' },
  { path: '/create/avatar', label: 'Avatar' },
  { path: '/create/result', label: 'Result' }
]

// Direction text is no longer collected from the user — it's built
// automatically once an avatar is picked, using this fixed template.
const buildPresetPrompt = (avatarName, garmentName) =>
  `Replace the outfit of the ${avatarName} with the garment uploaded as ${garmentName}.`
const avatars = [
  { id: 'preset-01', name: 'Asha', note: 'Warm editorial', skin: '#9f6549', hair: '#201b19', outfit: '#efe7da', backdrop: '#d8c7b7' },
  { id: 'preset-02', name: 'Jonas', note: 'Relaxed portrait', skin: '#c68964', hair: '#15120f', outfit: '#e7e1d4', backdrop: '#cbd3c7' },
  { id: 'preset-03', name: 'Nikhil', note: 'Clean close-up', skin: '#b97855', hair: '#16120f', outfit: '#f1eee6', backdrop: '#d4d0c5' },
  { id: 'preset-04', name: 'Pavan', note: 'Natural lifestyle', skin: '#8d573f', hair: '#211916', outfit: '#e8e0d1', backdrop: '#bfc8ba' },
  { id: 'preset-05', name: 'Mira', note: 'Soft studio', skin: '#d7a37a', hair: '#2a1d18', outfit: '#f5eee1', backdrop: '#dacfc1' },
  { id: 'preset-06', name: 'Kei', note: 'Modern minimal', skin: '#e0b58d', hair: '#151515', outfit: '#ece8df', backdrop: '#ced6d1' },
  { id: 'preset-07', name: 'Lina', note: 'Calm confident', skin: '#6f4436', hair: '#1b1413', outfit: '#e7ded0', backdrop: '#c1b6a7' },
  { id: 'preset-08', name: 'Omar', note: 'Outdoor ease', skin: '#bd7f5d', hair: '#211814', outfit: '#f2eadb', backdrop: '#c9cfbd' },
  { id: 'preset-09', name: 'Noor', note: 'Quiet luxury', skin: '#a86c4f', hair: '#221716', outfit: '#ebe5d8', backdrop: '#d7cbbb' },
  { id: 'preset-10', name: 'Elio', note: 'Street casual', skin: '#e2b085', hair: '#3a251c', outfit: '#eee9dc', backdrop: '#c8c2b7' },
  { id: 'preset-11', name: 'Sana', note: 'Polished neutral', skin: '#7d4c39', hair: '#100d0c', outfit: '#f4eddf', backdrop: '#cfc7bb' },
  { id: 'preset-12', name: 'Ira', note: 'Fresh daylight', skin: '#c98f69', hair: '#2b1d18', outfit: '#e9e4d8', backdrop: '#d8d8c9' },
  { id: 'preset-13', name: 'Ravi', note: 'Classic stance', skin: '#935b42', hair: '#18120f', outfit: '#f2eee5', backdrop: '#c5cabb' },
  { id: 'preset-14', name: 'Theo', note: 'Editorial lean', skin: '#dcb18a', hair: '#241815', outfit: '#ebe2d3', backdrop: '#d3c4b5' },
  { id: 'preset-15', name: 'Aya', note: 'Soft gaze', skin: '#b87555', hair: '#16120f', outfit: '#f5efe4', backdrop: '#c8d0ca' },
  { id: 'preset-16', name: 'Malik', note: 'Strong profile', skin: '#5f3b31', hair: '#100f0e', outfit: '#e8e2d6', backdrop: '#bfc4b7' },
  { id: 'preset-17', name: 'June', note: 'Playful polish', skin: '#f0c39b', hair: '#4a2b1e', outfit: '#f0eadf', backdrop: '#dbd0c3' },
  { id: 'preset-18', name: 'Tara', note: 'Elegant retail', skin: '#8b5a46', hair: '#211713', outfit: '#ede6d8', backdrop: '#c9cfc4' },
  { id: 'preset-19', name: 'Zayn', note: 'Everyday cool', skin: '#ca936d', hair: '#181411', outfit: '#f2ecdf', backdrop: '#d2cabf' },
  { id: 'preset-20', name: 'Anika', note: 'Bold natural', skin: '#754737', hair: '#15100e', outfit: '#e9e1d3', backdrop: '#c0c8bd' }
]
const avatarPromptDefaults = {
  gender: 'female',
  age: 'mid 20s',
  ethnicity: 'South Asian',
  skinTone: 'warm medium brown',
  genderPresentation: 'fashion model',
  bodyType: 'average build',
  hair: 'dark natural hair, neatly styled',
  expression: 'calm confident expression',
  pose: 'relaxed front-facing pose',
  style: 'minimal contemporary styling',
  background: 'seamless white studio',
  keywords: ''
}
const buildAvatarPromptParts = (input) => ({
  gender: input.gender === 'male' ? 'male' : 'female',
  prompt: [
    `A realistic full-body studio avatar of a ${input.age} ${input.ethnicity} ${input.genderPresentation}.`,
    `Skin tone: ${input.skinTone}. Body type: ${input.bodyType}. Hair: ${input.hair}.`,
    input.keywords?.trim() ? `Creative identity keywords: ${input.keywords.trim()}.` : '',
    'Natural proportions, visible face, clear healthy skin, fashion ecommerce ready.'
  ].filter(Boolean).join(' ') + ' ' + [
    `${input.pose}.`,
    `${input.expression}.`,
    'Full body visible head to toe, direct camera readability, hands and limbs natural.'
  ].join(' ') + ' ' + [
    'Simple fitted neutral base outfit for avatar generation only.',
    'Minimal accessories, clean clothing silhouette, ready for garment replacement in the try-on stage.'
  ].join(' ') + ' ' + [
    `${input.background}.`,
    'Clean minimal backdrop, even soft diffused lighting, no harsh shadows, full-body framing with margin above head and below feet.'
  ].join(' ') + ' ' + [
    `${input.style}.`,
    'Photorealistic editorial fashion catalog style, sharp focus, high detail, natural lighting, vertical full-body composition, no text, no logos, no watermark, no extra limbs.'
  ].join(' ')
})

const getSaved = () => {
  try { return JSON.parse(localStorage.getItem('stitches-project')) || {} } catch { return {} }
}

function App() {
  const [project, setProject] = useState(getSaved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)

  // The backend now keeps everything in memory, so any saved project
  // becomes invalid the moment the server restarts. Verify it before
  // trusting it, and drop it silently if it's gone.
  useEffect(() => {
    const verify = async () => {
      if (project.id) {
        try {
          const res = await apiFetch(`/api/projects/${project.id}`)
          if (!res.ok) throw new Error('stale')
        } catch {
          localStorage.removeItem('stitches-project')
          setProject({})
        }
      }
      setChecked(true)
    }
    verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => localStorage.setItem('stitches-project', JSON.stringify(project)), [project])

  // Pressing Enter anywhere activates whichever "primary" button is on
  // screen (the step footer's Next/Generate button, or the landing CTA).
  // Textareas keep normal Enter-for-newline behavior unless Ctrl/Cmd is
  // held; native buttons and links already respond to Enter on their own.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Enter' || e.repeat) return
      const tag = e.target.tagName
      if (tag === 'BUTTON' || tag === 'A') return
      if (tag === 'TEXTAREA' && !(e.metaKey || e.ctrlKey)) return
      const btn = document.querySelector('.primary')
      if (btn && !btn.disabled) {
        e.preventDefault()
        btn.click()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const update = (data) => setProject((p) => ({ ...p, ...data }))
  const reset = () => setProject({})
  if (!checked) return null
  return <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/create/*" element={<Studio project={project} update={update} reset={reset} busy={busy} setBusy={setBusy} error={error} setError={setError} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

function Landing() {
  const nav = useNavigate()
  return <main className="landing">
    <nav className="landing-nav"><Logo /><span className="nav-note">AI visual studio for fashion</span><button className="text-button" onClick={() => nav('/create/upload')}>Open studio <ArrowRight size={16} /></button></nav>
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow"><Sparkles size={14} /> Garment placement, reimagined</span>
        <h1>Your garment.<br /><em>Everywhere it belongs.</em></h1>
        <p>Place your products on brand-ready avatars with your own creative direction — at the speed of AI and with an eye for every detail.</p>
        <button className="primary large" onClick={() => nav('/create/upload')}>Create your first visual <ArrowRight size={18} /></button>
        <small>No design experience needed · Preview workflow</small>
      </div>
      <div className="hero-art" aria-label="Fashion campaign preview">
        <div className="poster poster-a">
          <img src="/port2.jpeg" alt="Fashion visual 1" />
        </div>

        <div className="poster poster-b">
          <img src="/port1.jpeg" alt="Fashion visual 2" />
        </div>
        <div className="art-stamp">BRAND<br />TRUE<br />VISUALS</div>
      </div>
    </section>
    <footer className="landing-footer"><span>Preserve the product</span><span>Protect the brand DNA</span><span>Move at culture speed</span></footer>
  </main>
}

function Logo() { return <div className="logo"><span className="mark">S</span><span>STITCHES</span></div> }

function Studio({ project, update, reset, busy, setBusy, error, setError }) {
  const loc = useLocation()
  const nav = useNavigate()
  const current = Math.max(0, stages.findIndex(s => s.path === loc.pathname))
  const patchProject = async (data) => {
    update(data)
    if (project.id) {
      const res = await apiFetch(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!res.ok) throw new Error((await res.json()).error)
    }
  }
  return <div className="studio-shell">
    <header className="studio-header"><Logo /><div className="progress-desktop">{stages.map((s, i) => <div key={s.path} className={`progress-item ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}><span>{i < current ? <Check size={12} /> : i + 1}</span><b>{s.label}</b></div>)}</div><button className="icon-button" title="Close studio" onClick={() => nav('/')}><X size={20} /></button></header>
    <div className="mobile-progress"><b>{current + 1} / {stages.length}</b><span>{stages[current]?.label}</span><i style={{ width: `${((current + 1) / stages.length) * 100}%` }} /></div>
    <Routes>
      <Route path="upload" element={<UploadStep project={project} update={update} nav={nav} busy={busy} setBusy={setBusy} error={error} setError={setError} />} />
      <Route path="avatar" element={<AvatarStep project={project} save={patchProject} update={update} nav={nav} busy={busy} setBusy={setBusy} error={error} setError={setError} />} />
      <Route path="result" element={<ResultStep project={project} update={update} reset={reset} nav={nav} />} />
      <Route path="*" element={<Navigate to="upload" replace />} />
    </Routes>
  </div>
}

function Step({ number, title, intro, children, footer }) {
  return <main className="step"><div className="step-heading"><span className="step-kicker">STEP {number} OF {stages.length}</span><h2>{title}</h2><p>{intro}</p></div><div className="step-body">{children}</div>{footer}</main>
}

function UploadStep({ project, update, nav, busy, setBusy, error, setError }) {
  const input = useRef()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(project.garmentUrl ? assetUrl(project.garmentUrl) : '')
  const choose = (f) => { if (!f) return; setError(''); if (!f.type.startsWith('image/')) return setError('Please choose an image file.'); setFile(f); setPreview(URL.createObjectURL(f)) }
  const submit = async () => {
    if (!file && !project.id) return setError('Add a garment image to continue.')
    if (project.id && !file) return nav('/create/avatar')
    setBusy(true); setError('')
    try {
      const body = new FormData(); body.append('garment', file)
      const res = await apiFetch('/api/projects', { method: 'POST', body })
      const data = await res.json(); if (!res.ok) throw new Error(data.error)
      update(data); nav('/create/avatar')
    } catch (e) { setError(e.message || 'Upload failed.') } finally { setBusy(false) }
  }
  return <Step number="01" title="Start with the garment" intro="Upload a clean product image. A front-facing shot on a plain background works beautifully." footer={<StepFooter next="Choose avatar" onNext={submit} busy={busy} />}>
    <div className={`upload-zone ${preview ? 'has-preview' : ''}`} onClick={() => input.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0]) }}>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => choose(e.target.files[0])} />
      {preview ? <><img src={preview} alt="Garment preview" /><button className="replace-pill"><RotateCcw size={14} /> Replace image</button></> : <><div className="upload-icon"><ImagePlus size={28} /></div><h3>Drop your garment here</h3><p>or click to browse your files</p><span>PNG, JPG or WEBP · Max 10 MB</span></>}
    </div>
    {error && <p className="error">{error}</p>}
    <div className="tip"><Sparkles size={16} /><span><b>For the best result</b> Use even lighting and make sure the entire garment is visible.</span></div>
  </Step>
}

function AvatarStep({ project, save, update, nav, busy, setBusy, error, setError }) {
  const [selected, setSelected] = useState(project.selectedAvatar || '')
  const [customAvatars, setCustomAvatars] = useState(project.customAvatars || [])
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatorError, setCreatorError] = useState('')
  const [avatarForm, setAvatarForm] = useState(avatarPromptDefaults)
  const allAvatars = [...customAvatars, ...avatars]
  const chooseAvatar = (avatar) => {
    setSelected(avatar.id)
    setError('')
  }
  const updateAvatarForm = (key, value) => setAvatarForm(form => ({ ...form, [key]: value }))
  const waitForAvatar = async (jobId) => {
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      const res = await apiFetch(`/api/avatars/generate/${encodeURIComponent(jobId)}/status`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not check avatar progress.')
      if (data.status === 'complete') return data
      if (data.status === 'failed') throw new Error(data.error || 'Avatar generation failed.')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('Avatar generation is taking longer than expected. Please try again shortly.')
  }
  const createAvatar = async () => {
    setCreating(true)
    setCreatorError('')
    setError('')
    try {
      const res = await apiFetch('/api/avatars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(avatarForm)
      })
      const queued = await res.json()
      if (!res.ok) throw new Error(queued.error || 'Could not queue avatar generation.')
      const completed = await waitForAvatar(queued.avatarJobId)
      const nextAvatar = {
        ...completed.avatar,
        name: `Custom ${customAvatars.length + 1}`,
        note: 'AI generated',
        prompt: completed.prompt
      }
      const nextCustomAvatars = [nextAvatar, ...customAvatars].slice(0, 8)
      setCustomAvatars(nextCustomAvatars)
      setSelected(nextAvatar.id)
      await save({
        selectedAvatar: nextAvatar.id,
        selectedAvatarName: nextAvatar.name,
        avatarPrompt: completed.prompt,
        customAvatars: nextCustomAvatars
      })
      setCreatorOpen(false)
    } catch (e) {
      setCreatorError(e.message || 'Could not create this avatar.')
    } finally {
      setCreating(false)
    }
  }
  const waitForGeneration = async (projectId) => {
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      const res = await apiFetch(`/api/projects/${projectId}/status`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not check generation progress.')
      update(data)
      if (data.status === 'complete') return data
      if (data.status === 'failed') throw new Error(data.error || 'Generation failed.')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('Generation is taking longer than expected. Your queued job is safe; try again shortly.')
  }
  const next = async () => {
    if (!selected) return setError('Choose an avatar to continue.')
    setBusy(true); setError('')
    try {
      const avatar = allAvatars.find(a => a.id === selected)
      const avatarName = avatar?.name || 'Selected avatar'
      const garmentName = project.garmentName || 'DRESS'
      await save({
        selectedAvatar: selected,
        selectedAvatarName: avatarName,
        avatarPrompt: avatar?.prompt || null,
        customAvatars,
        prompt: buildPresetPrompt(avatarName, garmentName)
      })
      const res = await apiFetch(`/api/projects/${project.id}/generate`, { method: 'POST' })
      const data = await res.json(); if (!res.ok) throw new Error(data.error)
      update(data)
      const completed = await waitForGeneration(project.id)
      update(completed)
      nav('/create/result')
    } catch (e) {
      setError(e.message || 'Could not generate this visual. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  if (!project.id) return <Navigate to="/create/upload" replace />
  return <Step number="02" title="Choose your canvas" intro="Pick from 20 preset avatars or create a custom AI avatar from guided attributes." footer={<StepFooter back onBack={() => nav('/create/upload')} next="Generate" busyLabel="Generating…" icon={<WandSparkles size={17} />} onNext={next} busy={busy || creating} />}>
    <div className="choice-grid avatars">
      <button type="button" onClick={() => setCreatorOpen(true)} className="choice-card avatar-card create-avatar-card">
        <div className="avatar-visual create-avatar-visual"><WandSparkles size={30} /><b>Create an avatar</b><span>Design one with age, ethnicity, skin tone, style, and keywords.</span></div>
        <div className="choice-meta"><span><b>AI custom</b><small>Prompt-built avatar</small></span><i>+</i></div>
      </button>
      {customAvatars.map(a => <button type="button" key={a.id} onClick={() => chooseAvatar(a)} className={`choice-card avatar-card ${selected === a.id ? 'selected' : ''}`}>
        <div className="avatar-visual"><img className="avatar-photo" src={assetUrl(a.image)} alt={`${a.name} avatar`} /><span className="dummy-tag">CUSTOM</span></div>
        <div className="choice-meta"><span><b>{a.name}</b><small>{a.note}</small></span><i>{selected === a.id && <Check size={15} />}</i></div>
      </button>)}
      {avatars.map(a => <button type="button" key={a.id} onClick={() => chooseAvatar(a)} className={`choice-card avatar-card ${selected === a.id ? 'selected' : ''}`}>
        <div className="avatar-visual placeholder-avatar" style={{ background: a.backdrop }}><MiniAvatar skin={a.skin} hair={a.hair} outfit={a.outfit} /></div>
        <div className="choice-meta"><span><b>{a.name}</b><small>{a.note}</small></span><i>{selected === a.id && <Check size={15} />}</i></div>
      </button>)}
    </div>
    {error && <p className="error">{error}</p>}
    {creatorOpen && <div className="modal-backdrop" role="presentation">
      <section className="avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatar-modal-title">
        <div className="modal-heading"><span className="eyebrow"><Sparkles size={14} /> Custom avatar</span><button className="icon-button" onClick={() => !creating && setCreatorOpen(false)} disabled={creating}><X size={18} /></button></div>
        <h3 id="avatar-modal-title">Design an avatar prompt</h3>
        <p>Choose the attributes, add a few keywords, and Stitches will send one constructed prompt to the avatar model.</p>
        <div className="avatar-builder">
          <label><span>Gender</span><select value={avatarForm.gender} onChange={e => updateAvatarForm('gender', e.target.value)}><option value="female">Female</option><option value="male">Male</option></select></label>
          <label><span>Age</span><input value={avatarForm.age} onChange={e => updateAvatarForm('age', e.target.value)} placeholder="mid 20s" /></label>
          <label><span>Ethnicity</span><input value={avatarForm.ethnicity} onChange={e => updateAvatarForm('ethnicity', e.target.value)} placeholder="South Asian" /></label>
          <label><span>Skin tone</span><input value={avatarForm.skinTone} onChange={e => updateAvatarForm('skinTone', e.target.value)} placeholder="warm medium brown" /></label>
          <label><span>Body type</span><input value={avatarForm.bodyType} onChange={e => updateAvatarForm('bodyType', e.target.value)} placeholder="average build" /></label>
          <label><span>Hair</span><input value={avatarForm.hair} onChange={e => updateAvatarForm('hair', e.target.value)} placeholder="dark natural hair" /></label>
          <label><span>Expression</span><input value={avatarForm.expression} onChange={e => updateAvatarForm('expression', e.target.value)} placeholder="calm confident expression" /></label>
          <label><span>Pose</span><input value={avatarForm.pose} onChange={e => updateAvatarForm('pose', e.target.value)} placeholder="relaxed front-facing pose" /></label>
          <label><span>Styling</span><input value={avatarForm.style} onChange={e => updateAvatarForm('style', e.target.value)} placeholder="minimal contemporary styling" /></label>
          <label><span>Background</span><input value={avatarForm.background} onChange={e => updateAvatarForm('background', e.target.value)} placeholder="seamless white studio" /></label>
          <label className="wide"><span>Keywords</span><textarea value={avatarForm.keywords} onChange={e => updateAvatarForm('keywords', e.target.value)} maxLength={500} placeholder="e.g. premium streetwear, grounded, cinematic daylight, confident retail model" /></label>
        </div>
        {creatorError && <p className="error">{creatorError}</p>}
        <div className="modal-actions"><button className="secondary" onClick={() => setCreatorOpen(false)} disabled={creating}>Cancel</button><button className="primary" onClick={createAvatar} disabled={creating}>{creating ? <><span className="spinner" /> Creating avatar…</> : <><WandSparkles size={17} /> Generate avatar</>}</button></div>
      </section>
    </div>}
  </Step>
}

function ResultStep({ project, update, reset, nav }) {
  const [regenerating, setRegenerating] = useState(false)
  const [feedback, setFeedback] = useState(project.feedback || '')
  const [resultError, setResultError] = useState('')
  const startOver = () => {
    localStorage.removeItem('stitches-project')
    reset()
    nav('/create/upload', { replace: true })
  }
  const submitFeedback = async (value) => {
    const next = feedback === value ? '' : value
    setFeedback(next)
    setResultError('')
    try {
      const res = await apiFetch(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feedback: next || null }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      update(data)
    } catch (error) {
      setFeedback(feedback)
      setResultError(error.message || 'Could not save feedback.')
    }
  }
  const regenerate = async () => {
    setRegenerating(true)
    setResultError('')
    setFeedback('')
    try {
      const queuedResponse = await apiFetch(`/api/projects/${project.id}/generate`, { method: 'POST' })
      const queued = await queuedResponse.json()
      if (!queuedResponse.ok) throw new Error(queued.error)
      update(queued)
      const deadline = Date.now() + 10 * 60 * 1000
      while (Date.now() < deadline) {
        const statusResponse = await apiFetch(`/api/projects/${project.id}/status`)
        const status = await statusResponse.json()
        if (!statusResponse.ok) throw new Error(status.error)
        update(status)
        if (status.status === 'complete') return
        if (status.status === 'failed') throw new Error(status.error || 'Generation failed.')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      throw new Error('Regeneration is taking longer than expected. You can try again shortly.')
    } catch (error) {
      setResultError(error.message || 'Could not regenerate this visual.')
    } finally {
      setRegenerating(false)
    }
  }
  if (!project.resultUrl) return <Navigate to="/create/avatar" replace />
  return <main className="result-page"><div className="result-copy"><span className="eyebrow"><Check size={14} /> Placement complete</span><h2>Your visual is ready.</h2><p>A first look at your garment on the avatar you selected.</p><div className="result-actions has-three"><a className="primary" href={assetUrl(project.resultUrl)} download="stitches-placement.png"><Download size={17} /> Download</a><button className="secondary" onClick={regenerate} disabled={regenerating}>{regenerating ? <><span className="spinner dark" /> Regenerating…</> : <><WandSparkles size={17} /> Regenerate</>}</button><button className="secondary" onClick={startOver} disabled={regenerating}><RotateCcw size={17} /> Start another</button></div><section className="feedback-block"><span>How did this placement turn out?</span><div><button className={feedback === 'good' ? 'selected' : ''} aria-pressed={feedback === 'good'} onClick={() => submitFeedback('good')}>👍 Good</button><button className={feedback === 'bad' ? 'selected' : ''} aria-pressed={feedback === 'bad'} onClick={() => submitFeedback('bad')}>👎 Bad</button></div></section>{resultError && <p className="error">{resultError}</p>}<div className="result-details"><span><b>Avatar</b>{project.selectedAvatarName || avatars.find(a => a.id === project.selectedAvatar)?.name || 'Custom avatar'}</span><span><b>Format</b>Generated output</span></div></div><section className={`comparison-panel ${regenerating ? 'is-loading' : ''}`}><figure className="comparison-card original"><figcaption><span>01</span> Uploaded garment</figcaption><div><img src={assetUrl(project.garmentUrl)} alt="Uploaded garment" /></div></figure><figure className="comparison-card generated"><figcaption><span>02</span> Generated result</figcaption><div><img src={assetUrl(project.resultUrl)} alt="Generated garment placement" />{regenerating && <span className="generation-overlay"><i className="spinner" /> Creating a new version…</span>}</div></figure></section></main>
}

function StepFooter({ back, onBack, next, onNext, busy, busyLabel = 'Working…', icon }) { return <footer className="step-footer"><div>{back && <button className="secondary" onClick={onBack} disabled={busy}><ArrowLeft size={17} /> Back</button>}</div><button className="primary" onClick={onNext} disabled={busy}>{busy ? <><span className="spinner" /> {busyLabel}</> : <>{icon}<span className="primary-text">{next}{icon && <small className="primary-hint">CTRL+ENTER</small>}</span><ArrowRight size={17} /></>}</button></footer> }

function MiniAvatar({ skin, hair, outfit }) { return <div className="mini-avatar"><div className="hair" style={{ background: hair }} /><div className="head" style={{ background: skin }}><i /><i /></div><div className="neck" style={{ background: skin }} /><div className="shirt" style={{ background: outfit }}><span /></div></div> }

export default App