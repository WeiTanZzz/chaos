import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const saltLength = 16
const ivLength = 12
const authTagLength = 16
const keyLength = 32

const deriveKey = (params: { passphrase: string; salt: Buffer }) => scryptSync(params.passphrase, params.salt, keyLength)

export const encrypt = (params: { plaintext: string; passphrase: string }) => {
    const salt = randomBytes(saltLength)
    const iv = randomBytes(ivLength)
    const cipher = createCipheriv("aes-256-gcm", deriveKey({ passphrase: params.passphrase, salt }), iv)
    const ciphertext = Buffer.concat([cipher.update(params.plaintext, "utf8"), cipher.final()])
    return Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString("base64")
}

export const decrypt = (params: { token: string; passphrase: string }) => {
    const payload = Buffer.from(params.token, "base64")
    if (payload.length < saltLength + ivLength + authTagLength) {
        throw new Error("token is too short to contain a salt, iv and auth tag")
    }
    const salt = payload.subarray(0, saltLength)
    const iv = payload.subarray(saltLength, saltLength + ivLength)
    const authTag = payload.subarray(saltLength + ivLength, saltLength + ivLength + authTagLength)
    const ciphertext = payload.subarray(saltLength + ivLength + authTagLength)
    const decipher = createDecipheriv("aes-256-gcm", deriveKey({ passphrase: params.passphrase, salt }), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

const usage = `usage:
  bun run --bun symmetric-cipher.ts encrypt <text> <key>
  bun run --bun symmetric-cipher.ts decrypt <token> <key>
  bun run --bun symmetric-cipher.ts selftest`

const selfTest = () => {
    const plaintext = "hello 世界 — aes-256-gcm"
    const passphrase = "correct horse battery staple"
    const token = encrypt({ plaintext, passphrase })
    const roundTripped = decrypt({ token, passphrase })
    const matches = timingSafeEqual(Buffer.from(roundTripped), Buffer.from(plaintext))
    console.log(`token:       ${token}`)
    console.log(`round trip:  ${roundTripped}`)
    console.log(`matches:     ${matches}`)

    const tampered = Buffer.from(token, "base64")
    const corrupted = Buffer.concat([tampered.subarray(0, tampered.length - 1), Buffer.from([tampered[tampered.length - 1] ^ 1])])
    try {
        decrypt({ token: corrupted.toString("base64"), passphrase })
        console.log("tampering:   NOT DETECTED")
    } catch {
        console.log("tampering:   rejected")
    }

    try {
        decrypt({ token, passphrase: "wrong key" })
        console.log("wrong key:   NOT DETECTED")
    } catch {
        console.log("wrong key:   rejected")
    }
}

const [command, ...args] = process.argv.slice(2)

if (command === "selftest") {
    selfTest()
} else if (command === "encrypt" || command === "decrypt") {
    const [input, passphrase] = args
    if (input === undefined || passphrase === undefined) {
        console.error(usage)
        process.exit(1)
    }
    try {
        console.log(command === "encrypt" ? encrypt({ plaintext: input, passphrase }) : decrypt({ token: input, passphrase }))
    } catch (error) {
        console.error(`${command} failed: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
    }
} else {
    console.error(usage)
    process.exit(1)
}
