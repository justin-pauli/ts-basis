/** eslint-disable */
const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const prettierRecommended = require('eslint-plugin-prettier/recommended')

module.exports = [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettierRecommended,
    {
        rules: {
            'no-empty': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': 'warn',
        },
        ignores: ['**/*.{js,cjs,mjs}'],
    },
]
