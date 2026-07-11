import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = process.env.SUPABASE_LOG_BUCKET || 'generation-logs'

const enabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
const supabase = enabled ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null

if (enabled) {
    console.log(`✅ generationLog: Supabase logging enabled (bucket: ${BUCKET})`)
} else {
    console.warn('⚠️  generationLog: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — generation logging is disabled.')
}

const extFromMime = (mimetype = '') => {
    if (mimetype.includes('jpeg')) return 'jpg'
    if (mimetype.includes('webp')) return 'webp'
    return 'png'
}

const uploadOne = async (buffer, mimetype, keyPrefix) => {
    const filePath = `${keyPrefix}-${Date.now()}.${extFromMime(mimetype)}`
    const { error } = await supabase.storage.from(BUCKET).upload(filePath, buffer, {
        contentType: mimetype || 'image/png',
        upsert: false
    })
    if (error) throw error
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath)
    return data.publicUrl
}

/**
 * Uploads the avatar / bg-removed garment / result images and inserts one row.
 * Returns the new row's id (needed later to attach a rating), or null if
 * logging is disabled or something failed — this is always best-effort and
 * must never break the actual generation flow.
 */
export const logGeneration = async ({
    id,
    avatarBuffer,
    avatarMimetype,
    garmentBuffer,
    garmentMimetype,
    resultBuffer,
    resultMimetype
}) => {
    if (!enabled) {
        console.warn(`generationLog: skipped for project ${id} — logging disabled (missing env vars).`)
        return null
    }
    console.log(`generationLog: uploading images for project ${id}…`)
    try {
        const [avatar_image_url, garment_no_bg_url, result_image_url] = await Promise.all([
            uploadOne(avatarBuffer, avatarMimetype, `${id}/avatar`),
            uploadOne(garmentBuffer, garmentMimetype, `${id}/garment`),
            uploadOne(resultBuffer, resultMimetype, `${id}/result`)
        ])
        console.log(`generationLog: images uploaded for project ${id}, inserting row…`)

        const { data, error } = await supabase
            .from('generation-logs')
            .insert({ avatar_image_url, garment_no_bg_url, result_image_url })
            .select('id')
            .single()

        if (error) throw error
        console.log(`generationLog: row inserted for project ${id} — log id ${data.id}`)
        return data.id
    } catch (err) {
        console.error(`generationLog: FAILED to log generation for project ${id} —`, err.message || err)
        return null
    }
}

/** Attaches a 1–10 rating to an existing log row. Best-effort, never throws. */
export const logRating = async (logId, rating) => {
    if (!enabled || !logId) return
    try {
        const { error } = await supabase
            .from('generation-logs')
            .update({ rating })
            .eq('id', logId)
        if (error) throw error
    } catch (err) {
        console.error('generationLog: failed to log rating —', err.message)
    }
}
