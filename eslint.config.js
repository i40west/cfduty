import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.serviceworker,
            },
        },
        rules: {
            'no-unused-vars': [ 'warn', { 'args': 'none' } ],
            'no-use-before-define': [ 'error', { 'functions': false } ],
            'no-extra-semi': 'warn'
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'warn'
        },
    }
]
