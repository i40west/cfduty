import js from "@eslint/js";
import globals from "globals";
import stylistic from '@stylistic/eslint-plugin';

export default [
    js.configs.recommended,
    {
        plugins: {
            '@stylistic': stylistic,
        },
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
            '@stylistic/no-extra-semi': 'warn',
            '@stylistic/semi': ['warn', 'always'],
            '@stylistic/comma-dangle': ['warn', 'always-multiline'],
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'warn',
        },
    },
];
