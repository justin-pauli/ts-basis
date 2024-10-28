import { v4 as uuidv4 } from 'uuid'

export function randIntRange(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1) + min)
}

export function shuffleString(str: string): string {
    return str
        .split('')
        .sort(() => Math.random() - 0.5)
        .join('')
}

export function randBase64Id(byteLength = 15) {
    const uuids = []
    const uuidsCount = Math.round(byteLength / 8) + 1
    for (let i = 0; i < uuidsCount; ++i) {
        uuids.push(uuidv4().split('-').join(''))
    }
    const hex = shuffleString(uuids.join(''))
    const bytes = new Uint8Array(byteLength * 2)
    for (let i = 0; i < byteLength * 2; ++i) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    const rawBase64 = btoa(String.fromCharCode.apply(null, bytes))
    return rawBase64
        .split('+')
        .join('')
        .split('/')
        .join('')
        .slice(0, (byteLength / 3) * 4)
}

const base34Charset = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'.split('')
export function randBase34(length = 64): string {
    const arr: string[] = []
    for (let i = 0; i < length; ++i) {
        arr.push(base34Charset[randIntRange(0, 33)])
    }
    return arr.join('')
}
