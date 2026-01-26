
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
    if (!secret) throw new Error('ENCRYPTION_KEY is not defined')

    const parts = text.split(':')
    if (parts.length !== 3) throw new Error('Invalid encrypted text format')

    const iv = Buffer.from(parts[0], 'hex')
    const encryptedText = parts[1]
    const tag = Buffer.from(parts[2], 'hex')
    const key = getKey(secret)

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM
    decipher.setAuthTag(tag)

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
}
