import { isNodeJs } from './env.util'

// TODO: use Buffer based on isNodeJs
export class Codec {
    static bytesToString(bytes: Uint8Array) {
        // String.fromCharCode has arg length limit of < 100000
        const chunks: string[] = []
        const chunkSize = 2048
        let end = chunkSize
        for (let i = 0; i < bytes.length; ) {
            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, end)))
            i = end
            end += chunkSize
        }
        return chunks.join('')
    }

    static utf8ToBase64(str: string) {
        const asciiBytes = new TextEncoder().encode(str)
        return btoa(this.bytesToString(asciiBytes))
    }

    static bytesToBase64(bytes: Uint8Array) {
        return btoa(this.bytesToString(bytes))
    }

    static bytesToUtf8(bytes: Uint8Array) {
        return new TextDecoder('utf8').decode(bytes)
    }

    static base64ToBytes(b64: string) {
        const decoded = atob(b64)
        const bytes = new Uint8Array(decoded.length)
        for (let i = 0; i < bytes.length; ++i) {
            bytes[i] = decoded.charCodeAt(i)
        }
        return bytes
    }

    static base64ToUtf8(b64: string) {
        const bytes = this.base64ToBytes(b64)
        return new TextDecoder('utf8').decode(bytes)
    }
}
