export type VValidator<T, OPT = object> = {
    valid: (v: T, opt?: OPT) => boolean
    conform: (v: T, opt?: OPT) => T
}

type VVTextOptionsBase = {
    trim?: boolean
}

class VVTextValidations {
    static wordsAndSpaces: VValidator<
        string,
        VVTextOptionsBase & { strict?: boolean }
    > = {
        valid: (v, opt) => {
            v ??= ''
            opt ??= { trim: true }
            return v === vv.text.wordsAndSpaces.conform(v, opt)
        },
        conform: (v, opt) => {
            v ??= ''
            opt ??= { trim: true }
            if (opt.strict) {
                v = v.replace(/[^\p{L}\d]/gu, '')
            } else {
                v = v.replace(/[^\p{L}\d \-_]/gu, '')
                v = v.replace(/__+/g, '_')
                v = v.replace(/[--]+/g, '-')
                v = v.replace(/[-]_+/g, '-')
                v = v.replace(/_[-]+/g, '-')
                const lit = v.split(' ').map(a => {
                    while (a.startsWith('_') || a.startsWith('-')) {
                        a = a.slice(1)
                    }
                    while (a.endsWith('_') || a.endsWith('-')) {
                        a = a.slice(0, -1)
                    }
                    return a
                })
                v = lit.join(' ')
            }
            v = v.replace(/\s\s+/g, ' ')
            if (opt.trim) {
                v = v.trim()
            }
            return v
        },
    }

    static wordsAndUnderscores: VValidator<string, VVTextOptionsBase> = {
        valid: (v, opt) => {
            v ??= ''
            opt ??= { trim: true }
            return v === vv.text.wordsAndUnderscores.conform(v, opt)
        },
        conform: (v, opt) => {
            v ??= ''
            opt ??= { trim: true }
            v = v.replace(/[^\p{L}\d]/gu, '_')
            v = v.replace(/_+/g, '_')
            if (opt.trim) {
                v = v.startsWith('_') ? v.slice(1) : v
                v = v.endsWith('_') ? v.slice(0, -1) : v
            }
            return v
        },
    }
}

/**
 * vv: validation library
 */
export class vv {
    static text = VVTextValidations
}
