export function deepCopy(obj: any) {
    if (global.structuredClone) {
        return global.structuredClone(obj)
    } else {
        return JSON.parse(JSON.stringify(obj))
    }
}

export function valueMap(
    arr: any[],
    mapper: (v: any) => string = v => v + '',
): { [key: string]: boolean } {
    const obj: { [key: string]: boolean } = {}
    for (const el of arr) {
        obj[mapper(el)] = true
    }
    return obj
}

export function isJsonString(str: string) {
    return (
        (str.startsWith('{') && str.endsWith('}')) ||
        (str.startsWith('[') && str.endsWith(']'))
    )
}
