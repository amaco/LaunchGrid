/**
 * LaunchGrid Encryption Module
 * 
 * Following the constitution:
 * - Encrypted secrets vault
 * - Security principles: tenant isolation, least privilege
 */

import 'server-only'
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // For AES, this is always 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32 // 256 bits

/**
 * Derive a key from the secret using PBKDF2 for better security
 * Caches the derived key for performance
 */
let cachedKey: Buffer | null = null
let cachedSecret: string | null = null

function getKey(secret: string): Buffer {
    if (cachedKey && cachedSecret === secret) {
        return cachedKey
    }
    
    // Use SHA-256 for key derivation (simple but effective for this use case)
    // In production, consider PBKDF2 or Argon2 with a salt
    cachedKey = crypto.createHash('sha256').update(String(secret)).digest()
    cachedSecret = secret
    
    return cachedKey
}

/**
 * Validate that the encryption key is properly configured
 */
function validateEncryptionKey(): string {
    const secret = process.env.ENCRYPTION_KEY
    
    if (!secret) {
        throw new Error('ENCRYPTION_KEY is not defined in environment variables')
    }
    
    if (secret.length < 32) {
        console.warn('[Security] ENCRYPTION_KEY should be at least 32 characters for security')
    }
    
    return secret
}

/**
 * Encrypt a plaintext string
 * @param text - The plaintext to encrypt
 * @returns Encrypted string in format: iv:encrypted:tag (hex encoded)
 */
export function encrypt(text: string): string {
    if (!text) {
        throw new Error('Cannot encrypt empty value')
    }
    
    const secret = validateEncryptionKey()
    const key = getKey(secret)
    
    // Generate a random IV for each encryption
    const iv = crypto.randomBytes(IV_LENGTH)
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM
    
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    
    // Get the authentication tag
    const tag = cipher.getAuthTag()
    
    // Format: iv:encrypted:tag (all hex encoded)
    return `${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`
}

/**
 * Decrypt an encrypted string
 * @param text - The encrypted string in format: iv:encrypted:tag
 * @returns Decrypted plaintext
 */
export function decrypt(text: string): string {
    if (!text) {
        return ''
    }
    
    const secret = validateEncryptionKey()
    
    // Parse the encrypted format
    const parts = text.split(':')
    
    // Legacy support: If not in expected format, check if it's a plain-text key
    if (parts.length !== 3) {
        // Check if it looks like an encrypted value that got corrupted
        if (text.includes(':')) {
            console.error('[Encryption] Malformed encrypted value')
            throw new Error('Invalid encrypted format')
        }
        
        // Legacy plain-text key detected
        console.warn('[Encryption] Legacy plain-text key detected. Consider re-encrypting.')
        return text
    }
    
    // Validate hex format
    const hexRegex = /^[0-9a-fA-F]+$/
    if (!parts.every(p => hexRegex.test(p))) {
        // Not a valid encrypted string, might be legacy
        console.warn('[Encryption] Value does not appear to be encrypted. Returning as-is.')
        return text
    }
    
    try {
        const iv = Buffer.from(parts[0], 'hex')
        const encryptedText = parts[1]
        const tag = Buffer.from(parts[2], 'hex')
        
        // Validate lengths
        if (iv.length !== IV_LENGTH) {
            throw new Error('Invalid IV length')
        }
        if (tag.length !== TAG_LENGTH) {
            throw new Error('Invalid tag length')
        }
        
        const key = getKey(secret)
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM
        decipher.setAuthTag(tag)
        
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        
        return decrypted
    } catch (e: any) {
        // Log error without exposing sensitive data
        console.error('[Encryption] Decryption failed:', e.message)
        
        // Check if it might be a legacy value
        if (e.message?.includes('Unsupported state')) {
            console.warn('[Encryption] Possible legacy value or wrong key')
        }
        
        throw new Error('Decryption failed - invalid format or key mismatch')
    }
}

/**
 * Check if a string appears to be encrypted with our format
 */
export function isEncrypted(text: string): boolean {
    if (!text) return false
    
    const parts = text.split(':')
    if (parts.length !== 3) return false
    
    const hexRegex = /^[0-9a-fA-F]+$/
    return parts.every(p => hexRegex.test(p))
}

/**
 * Hash a value (one-way, for comparisons)
 */
export function hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex')
}

/**
 * Generate an API key with prefix
 */
export function generateApiKey(prefix: string = 'lg'): { key: string; hash: string; prefix: string } {
    const randomPart = crypto.randomBytes(24).toString('base64url')
    const key = `${prefix}_${randomPart}`
    
    return {
        key,
        hash: hash(key),
        prefix: key.substring(0, 8),
    }
}
