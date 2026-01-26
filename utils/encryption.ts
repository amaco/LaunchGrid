
import 'server-only'
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // For AES, this is always 16
const SALT_LENGTH = 64
const TAG_LENGTH = 16

function getKey(secret: string) {
    return crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32);
}

export function encrypt(text: string): string {
    const secret = process.env.ENCRYPTION_KEY
    if (!secret) throw new Error('ENCRYPTION_KEY is not defined')

    const iv = crypto.randomBytes(IV_LENGTH)
    const key = getKey(secret)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM

    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const tag = cipher.getAuthTag()

    // Format: iv:encrypted:tag
    return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`
}

export function decrypt(text: string): string {
    const secret = process.env.ENCRYPTION_KEY
    if (!secret) {
        console.error("ENCRYPTION_KEY is missing from environment variables")
        // Fail safe: If we can't decrypt, we can't use the key.
        throw new Error('Server Error: Security configuration missing (ENCRYPTION_KEY)')
    }

    if (!text) return '';

    // Legacy Support: If text doesn't look like "iv:content:tag", assume it's an old plain-text key
    // Most API keys (sk-..., AIza...) don't contain colons usually, or definitely not in this specific 3-part hex format
    const parts = text.split(':')
    if (parts.length !== 3) {
        console.warn("Legacy plain-text key detected. Returning as-is.")
        return text
    }

    try {
        const iv = Buffer.from(parts[0], 'hex')
        const encryptedText = parts[1]
        const tag = Buffer.from(parts[2], 'hex')
        const key = getKey(secret)

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM
        decipher.setAuthTag(tag)

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
        decrypted += decipher.final('utf8')

        return decrypted
    } catch (e) {
        console.error("Decryption failed", e)
        throw new Error('Invalid Secret Format')
    }
}
